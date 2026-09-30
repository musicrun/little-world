# Little World

An original miniature self-driving world inspired by [Radu Mariescu-Istodor’s virtual-world tutorial](https://www.youtube.com/watch?v=5iHejdqYIa8). The map is procedural and editable through `map.json`. The Python host keeps the simulation running even with no browser open; the webpage is a live viewing window.

## What is in the world

- A connected road graph with a one-way roundabout, intersections, traffic lights, stop signs, and yield points.
- Generated roads with dashed lane markings and crosswalks, plus buildings and trees with depth and shadows.
- 38 cars that keep moving on continuous routes. New driving policies never reset a car’s position.
- Forward traffic sensing, road-edge sensor rays on the followed car, and a 6–8–2 neural controller. A baseline steering controller keeps the cars drivable; the network adjusts steering and speed. Evolutionary trials select and mutate the strongest policy using progress, speed, lane discipline, traffic-rule violations, and collisions.
- Follow camera, unified zoom/pan, neural-network view, and minimap.
- Full world checkpoints roughly every 12 seconds.

## Run

Python standard library only:

```sh
HOST=0.0.0.0 PORT=8799 python3 server.py
```

The installed Linux user service is `little-world.service`. It restarts on failure and runs after logout because user lingering is enabled on the host. The computer must stay powered on for the world to keep learning. The viewer is available on the LAN at `http://192.168.1.114:8799`.

## Change the map

Edit `map.json`: each node has an `id`, `x`, and `y`; an optional `control` is `light`, `stop`, or `yield`. Each edge references two node IDs and can be marked `oneway`. The renderer and driving graph both read this file, so roads and cars stay aligned. Changing the map requires restarting the service; archive `checkpoint.json` first if you want to keep the old world’s state.

The service exposes read-only state and static files to the LAN. It is not a public Internet deployment.
