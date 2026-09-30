"""Persistent road world with a small evolutionary neural driving controller."""
import bisect
import json
import math
import os
import random
import threading
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MAP = json.loads((ROOT / "map.json").read_text())
SAVE = ROOT / "checkpoint.json"
CAR_COUNT = 38
INPUTS, HIDDEN, OUTPUTS = 6, 8, 2
BRAIN_SIZE = INPUTS * HIDDEN + HIDDEN + HIDDEN * OUTPUTS + OUTPUTS
RAY_ANGLES = (-0.8, -0.4, 0, 0.4, 0.8)


def clamp(v, low, high):
    return max(low, min(high, v))


def angle_diff(a, b):
    return (a - b + math.pi) % (2 * math.pi) - math.pi


def distance_to_segment(x, y, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = clamp(((x - ax) * dx + (y - ay) * dy) / max(0.001, dx * dx + dy * dy), 0, 1)
    return math.hypot(x - ax - t * dx, y - ay - t * dy)


def raw_position(path, s):
    s = clamp(s, 0, path["total"] - 0.0001)
    i = clamp(bisect.bisect_right(path["cum"], s) - 1, 0, len(path["points"]) - 2)
    a, b = path["points"][i:i + 2]
    t = (s - path["cum"][i]) / max(0.001, path["cum"][i + 1] - path["cum"][i])
    return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, math.atan2(b[1] - a[1], b[0] - a[0])


def position(path, s):
    x, y, heading = raw_position(path, s)
    if 24 < s < path["total"] - 24:
        bx, by, _ = raw_position(path, s - 24)
        fx, fy, _ = raw_position(path, s + 24)
        heading = math.atan2(fy - by, fx - bx)
    return x, y, heading


def neural(weights, inputs):
    hidden = []
    for h in range(HIDDEN):
        row = h * INPUTS
        total = weights[INPUTS * HIDDEN + h]
        for i in range(INPUTS):
            total += inputs[i] * weights[row + i]
        hidden.append(math.tanh(total))
    outputs = []
    offset = INPUTS * HIDDEN + HIDDEN
    for o in range(OUTPUTS):
        total = weights[offset + HIDDEN * OUTPUTS + o]
        for h in range(HIDDEN):
            total += hidden[h] * weights[offset + o * HIDDEN + h]
        outputs.append(math.tanh(total))
    return hidden, outputs


class RoadGraph:
    def __init__(self):
        self.nodes = {n["id"]: n for n in MAP["nodes"]}
        self.adj = defaultdict(list)
        self.segments = []
        for e in MAP["edges"]:
            a, b = e["a"], e["b"]
            x1, y1 = self.nodes[a]["x"], self.nodes[a]["y"]
            x2, y2 = self.nodes[b]["x"], self.nodes[b]["y"]
            length = math.hypot(x2 - x1, y2 - y1)
            self.adj[a].append((b, length))
            if not e.get("oneway"):
                self.adj[b].append((a, length))
            self.segments.append((x1, y1, x2, y2))
        self.starts = [n for n in self.nodes if len(self.adj[n]) > 1]

    def route(self, rng, start=None, prev=None, target=1900):
        current = rng.choice(self.starts) if start is None else start
        previous = prev
        ids = [current]
        visited = {current}
        total = 0
        for _ in range(120):
            choices = [e for e in self.adj[current] if e[0] != previous]
            if not choices:
                choices = self.adj[current]
            if not choices:
                break
            fresh = [e for e in choices if e[0] not in visited]
            if fresh and rng.random() < 0.7:
                choices = fresh
            if previous is not None:
                a, b = self.nodes[previous], self.nodes[current]
                vx, vy = b["x"] - a["x"], b["y"] - a["y"]
                def weight(edge):
                    n, length = edge
                    c = self.nodes[n]
                    dot = (vx * (c["x"] - b["x"]) + vy * (c["y"] - b["y"])) / max(0.001, math.hypot(vx, vy) * length)
                    return dot + rng.random() * 1.1
                nxt, length = max(choices, key=weight)
            else:
                nxt, length = rng.choice(choices)
            previous, current = current, nxt
            ids.append(current)
            visited.add(current)
            total += length
            if total >= target:
                break
        points = [(self.nodes[n]["x"], self.nodes[n]["y"]) for n in ids]
        cumulative = [0]
        for a, b in zip(points, points[1:]):
            cumulative.append(cumulative[-1] + math.dist(a, b))
        controls = []
        for i, n in enumerate(ids[1:], 1):
            kind = self.nodes[n].get("control")
            if kind:
                controls.append((cumulative[i], kind, n))
        return {"ids": ids, "points": points, "cum": cumulative,
                "total": cumulative[-1], "controls": controls}


class World:
    def __init__(self):
        self.lock = threading.Lock()
        self.rng = random.Random()
        self.graph = RoadGraph()
        self.best_brain = [0.0] * BRAIN_SIZE
        self.best_score = -1e9
        self.cycles = 0
        self.elapsed = 0
        self.collisions = 0
        self.violations = 0
        self.last_save = time.monotonic()
        restored = None
        try:
            saved = json.loads(SAVE.read_text())
            if saved.get("version") in (1, 2):
                self.best_brain = saved["best_brain"]
                self.best_score = saved["best_score"] if saved.get("version") == 2 else -1e9
                self.cycles = saved["cycles"]
                self.elapsed = saved["elapsed"]
                self.collisions = saved["collisions"]
                self.violations = saved["violations"]
                restored = saved.get("cars")
        except (OSError, ValueError, KeyError, TypeError):
            pass
        self.cars = restored or [self.new_car(i) for i in range(CAR_COUNT)]
        for car in self.cars:
            car["cleared"] = set(car["cleared"])

    def mutate(self):
        if self.rng.random() < 0.08:
            return [self.rng.gauss(0, 0.15) for _ in range(BRAIN_SIZE)]
        return [clamp(w + self.rng.gauss(0, 0.10), -2, 2) for w in self.best_brain]

    def new_car(self, index):
        path = self.graph.route(self.rng)
        return {"id": index, "path": path, "s": self.rng.uniform(0, path["total"] * 0.65),
                "speed": self.rng.uniform(25, 42), "lateral": 0.0, "heading_error": 0.0,
                "brain": self.mutate(), "fitness": 0.0, "travel": 0.0, "age": 0.0,
                "cleared": set(), "stopped": 0.0, "color": index % 6}

    def extend(self, car):
        path = car["path"]
        if car["s"] < path["total"] - 125:
            return
        extra = self.graph.route(self.rng, path["ids"][-1], path["ids"][-2], 900)
        offset = path["total"]
        path["ids"].extend(extra["ids"][1:])
        path["points"].extend(extra["points"][1:])
        path["cum"].extend(offset + d for d in extra["cum"][1:])
        path["controls"].extend((offset + d, kind, node) for d, kind, node in extra["controls"])
        path["total"] = path["cum"][-1]
        if car["s"] > 650:
            cut = max(0, bisect.bisect_right(path["cum"], car["s"] - 180) - 1)
            if cut:
                shift = path["cum"][cut]
                path["ids"] = path["ids"][cut:]
                path["points"] = path["points"][cut:]
                path["cum"] = [d - shift for d in path["cum"][cut:]]
                path["controls"] = [(d - shift, kind, node) for d, kind, node in path["controls"] if d > shift]
                path["total"] = path["cum"][-1]
                car["s"] -= shift
                car["cleared"] = {d - shift for d in car["cleared"] if d > shift}

    def green(self, node):
        return (int(self.elapsed / 11) + node % 3) % 2 == 0

    def physical(self, car):
        x, y, road_heading = position(car["path"], car["s"])
        right = 12 + car["lateral"]
        return (x - math.sin(road_heading) * right,
                y + math.cos(road_heading) * right,
                road_heading + car["heading_error"])

    def tick(self, dt):
        with self.lock:
            self.elapsed += dt
            for car in self.cars:
                self.extend(car)
            poses = [self.physical(c) for c in self.cars]
            for car, (x, y, heading) in zip(self.cars, poses):
                path = car["path"]
                _, _, road_heading = position(path, car["s"])
                future = position(path, min(path["total"] - .001, car["s"] + 65))[2]
                curve = abs(angle_diff(future, road_heading))
                nearest = 130
                for other, (ox, oy, _) in zip(self.cars, poses):
                    if other is car:
                        continue
                    ahead = (ox - x) * math.cos(heading) + (oy - y) * math.sin(heading)
                    if 0 < ahead < 125:
                        sideways = abs(-(ox - x) * math.sin(heading) + (oy - y) * math.cos(heading))
                        if sideways < 20:
                            nearest = min(nearest, math.hypot(ox - x, oy - y))
                upcoming = None
                for mark, kind, node in path["controls"]:
                    d = mark - car["s"]
                    if mark in car["cleared"] or not 0 < d < 120:
                        continue
                    if upcoming is None or d < upcoming[0]:
                        upcoming = (d, kind, mark, node)
                red = 0
                target = 62
                if curve > 0.3:
                    target = min(target, 39)
                if nearest < 100:
                    target = min(target, max(8, (nearest - 17) * .9))
                if upcoming:
                    d, kind, mark, node = upcoming
                    if kind == "stop":
                        red = 1
                        target = min(target, max(0, (d - 14) * .85))
                        if d < 18 and car["speed"] < 3:
                            car["stopped"] += dt
                            if car["stopped"] > .6:
                                car["cleared"].add(mark)
                    elif kind == "light" and not self.green(node):
                        red = 1
                        target = min(target, max(0, (d - 14) * .85))
                    elif kind == "yield":
                        target = min(target, max(20, d * .8))
                inputs = [clamp(car["lateral"] / 25, -1, 1),
                          clamp(car["heading_error"], -1, 1),
                          clamp(curve / 1.5, 0, 1),
                          clamp(nearest / 130, 0, 1),
                          red, clamp(car["speed"] / 80, 0, 1)]
                car["inputs"] = inputs
                _, outputs = neural(car["brain"], inputs)
                steer = clamp(-.045 * car["lateral"] - 1.7 * car["heading_error"] + outputs[0] * .55, -1.7, 1.7)
                target = clamp(target + outputs[1] * 7, 0, 78)
                car["speed"] += clamp(target - car["speed"], -95 * dt, 32 * dt)
                old_s = car["s"]
                car["heading_error"] += steer * dt
                step = max(0, car["speed"] * math.cos(car["heading_error"]) * dt)
                car["s"] += step
                car["travel"] += step
                car["age"] += dt
                car["lateral"] += math.sin(car["heading_error"]) * car["speed"] * dt
                _, _, new_heading = position(path, car["s"])
                car["heading_error"] = clamp(angle_diff(car["heading_error"] + road_heading, new_heading), -1.4, 1.4)
                car["lateral"] = clamp(car["lateral"], -58, 58)
                car["fitness"] += step * .022 - dt * (.07 + .012 * abs(car["lateral"]) + (.45 if abs(car["lateral"]) > 23 else 0))
                for mark, kind, node in path["controls"]:
                    if old_s < mark <= car["s"]:
                        if kind == "stop" and mark not in car["cleared"]:
                            car["fitness"] -= 20
                            self.violations += 1
                        elif kind == "light" and not self.green(node):
                            car["fitness"] -= 22
                            self.violations += 1
                if car["travel"] >= 950 or car["age"] > 75:
                    score = car["fitness"] - max(0, car["age"] - 60) * .1
                    if score > self.best_score:
                        self.best_score = score
                        self.best_brain = car["brain"][:]
                    self.cycles += 1
                    car["brain"] = self.mutate()
                    car["fitness"] = car["travel"] = car["age"] = 0
            cells = defaultdict(list)
            for car in self.cars:
                x, y, _ = self.physical(car)
                key = (int(x // 22), int(y // 22))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for other, ox, oy in cells.get((key[0] + dx, key[1] + dy), ()):
                            if math.hypot(x - ox, y - oy) < 13:
                                car["fitness"] -= .08
                                other["fitness"] -= .08
                                if self.rng.random() < .004:
                                    self.collisions += 1
                cells[key].append((car, x, y))
            if time.monotonic() - self.last_save > 12:
                self.save()
                self.last_save = time.monotonic()

    def rays(self, car):
        x, y, heading = self.physical(car)
        rays = []
        for offset in RAY_ANGLES:
            a = heading + offset
            distance = 120
            for d in range(5, 121, 5):
                px, py = x + math.cos(a) * d, y + math.sin(a) * d
                on_road = any(distance_to_segment(px, py, *seg) < MAP["roadWidth"] / 2 for seg in self.graph.segments)
                near_car = any(other is not car and math.hypot(px - self.physical(other)[0], py - self.physical(other)[1]) < 9 for other in self.cars)
                if not on_road or near_car:
                    distance = d
                    break
            rays.append([round(x + math.cos(a) * distance, 1), round(y + math.sin(a) * distance, 1), round(distance / 120, 2)])
        return rays

    def save(self):
        data = {"version": 2, "best_brain": self.best_brain, "best_score": self.best_score,
                "cycles": self.cycles, "elapsed": self.elapsed, "collisions": self.collisions,
                "violations": self.violations,
                "cars": [{**c, "cleared": list(c["cleared"])} for c in self.cars]}
        temp = SAVE.with_suffix(".tmp")
        temp.write_text(json.dumps(data))
        os.replace(temp, SAVE)

    def snapshot(self):
        with self.lock:
            cars = []
            for car in self.cars:
                x, y, heading = self.physical(car)
                cars.append({"id": car["id"], "x": round(x, 1), "y": round(y, 1),
                             "angle": round(heading, 3), "color": car["color"],
                             "lateral": round(car["lateral"], 1)})
            focus = self.cars[0]
            inputs = focus.get("inputs", [0, 0, 0, 1, 0, 0])
            hidden, outputs = neural(focus["brain"], inputs)
            return {"cars": cars, "rays": self.rays(focus),
                    "brain": {"weights": focus["brain"], "inputs": inputs, "hidden": hidden, "outputs": outputs},
                    "lights": {str(n): self.green(n) for n in self.graph.nodes if self.graph.nodes[n].get("control") == "light"},
                    "elapsed": round(self.elapsed), "cycles": self.cycles,
                    "best": round(self.best_score, 1), "collisions": self.collisions}
