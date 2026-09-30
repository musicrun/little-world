const scene=document.getElementById("scene");
const worldCanvas=document.getElementById("world");
const brainCanvas=document.getElementById("brain");
const miniCanvas=document.getElementById("mini");
const ctx=worldCanvas.getContext("2d");
const brainCtx=brainCanvas.getContext("2d");
const miniCtx=miniCanvas.getContext("2d");
const colors=["#306dbb","#db745d","#edc26d","#93c9ae","#a591cf","#eff1e7"];
let mapData=null,buildings=[],trees=[],state=null,previous=null,received=0;
let camera={x:770,y:500,zoom:1.15,follow:true};
let dragging=false,lastPointer=null;

function rng(seed){return function(){seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296}}
function sizeCanvas(canvas){const d=window.devicePixelRatio||1;const r=canvas.getBoundingClientRect();canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);canvas.getContext("2d").setTransform(d,0,0,d,0,0)}
function resize(){[worldCanvas,brainCanvas,miniCanvas].forEach(sizeCanvas)}
window.addEventListener("resize",resize);
function distanceSegment(x,y,a,b){const dx=b.x-a.x,dy=b.y-a.y;const t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a.x-t*dx,y-a.y-t*dy)}
function prepare(data){
  mapData=data;const rand=rng(data.seed),nodes=data.nodes;
  const roads=data.edges.map(e=>[nodes[e.a],nodes[e.b]]);
  function clear(x,y,r){return roads.every(([a,b])=>distanceSegment(x,y,a,b)>data.roadWidth/2+r+8)&&Math.hypot(x-data.circle.x,y-data.circle.y)>data.circle.r+r+30}
  let trials=0;
  while(buildings.length<88&&trials++<6000){
    const x=70+rand()*(data.width-140),y=70+rand()*(data.height-140);
    const w=38+rand()*58,h=30+rand()*47;
    if(!clear(x,y,Math.max(w,h)*.64))continue;
    if(buildings.some(b=>Math.abs(x-b.x)<(w+b.w)/2+12&&Math.abs(y-b.y)<(h+b.h)/2+12))continue;
    buildings.push({x,y,w,h,height:9+rand()*18,roof:rand()<.18?"#bd786d":rand()<.15?"#9aaeb0":"#d8d9d2"});
  }
  trials=0;
  while(trees.length<130&&trials++<6000){
    const x=35+rand()*(data.width-70),y=35+rand()*(data.height-70),r=10+rand()*8;
    if(!clear(x,y,r+8))continue;
    if(buildings.some(b=>Math.abs(x-b.x)<b.w/2+r+5&&Math.abs(y-b.y)<b.h/2+r+5))continue;
    trees.push({x,y,r,tint:rand()});
  }
}
fetch("/map.json").then(r=>r.json()).then(prepare);
function line(a,b,width,color,dash=[]){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineWidth=width;ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle=color;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([])}
function drawBuilding(b){
  const x=b.x-b.w/2,y=b.y-b.h/2,dx=10,dy=b.height;
  ctx.fillStyle="#1e4b3d55";ctx.beginPath();ctx.rect(x+dx+5,y+dy+5,b.w,b.h);ctx.fill();
  ctx.fillStyle="#969c98";ctx.beginPath();ctx.moveTo(x+b.w,y);ctx.lineTo(x+b.w+dx,y+dy);ctx.lineTo(x+b.w+dx,y+b.h+dy);ctx.lineTo(x+b.w,y+b.h);ctx.closePath();ctx.fill();
  ctx.fillStyle="#a5aaa6";ctx.beginPath();ctx.moveTo(x,y+b.h);ctx.lineTo(x+dx,y+b.h+dy);ctx.lineTo(x+b.w+dx,y+b.h+dy);ctx.lineTo(x+b.w,y+b.h);ctx.closePath();ctx.fill();
  ctx.fillStyle=b.roof;ctx.strokeStyle="#74817b";ctx.lineWidth=1.2;ctx.beginPath();ctx.rect(x,y,b.w,b.h);ctx.fill();ctx.stroke();
  ctx.strokeStyle="#ffffff55";ctx.strokeRect(x+5,y+5,b.w-10,b.h-10);
}
function drawTree(t){
  const {x,y,r}=t;
  ctx.fillStyle="#21463499";ctx.beginPath();ctx.ellipse(x+11,y+16,r*1.05,r*.75,-.3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#265e43";ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=t.tint>.5?"#50a66b":"#439962";
  for(const [dx,dy,f] of [[-r*.3,-r*.2,.55],[r*.38,-r*.16,.5],[-r*.06,r*.35,.55]]){
    ctx.beginPath();ctx.arc(x+dx,y+dy,r*f,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle="#87c88a";ctx.beginPath();ctx.arc(x-r*.25,y-r*.4,r*.23,0,Math.PI*2);ctx.fill();
}
function drawRoads(){
  const nodes=mapData.nodes,edges=mapData.edges;
  for(const pass of [0,1]){
    for(const e of edges){
      const w=e.kind==="main"?61:e.kind==="roundabout"?56:mapData.roadWidth;
      line(nodes[e.a],nodes[e.b],w+(pass?0:8),pass?"#bec4c2":"#e7e7df");
    }
  }
  const c=mapData.circle;
  ctx.fillStyle="#59aa77";ctx.strokeStyle="#e2e5dd";ctx.lineWidth=4;
  ctx.beginPath();ctx.arc(c.x,c.y,c.r-29,0,Math.PI*2);ctx.fill();ctx.stroke();
  // Lane centers stop short of junctions, leaving the crossings open.
  for(const e of edges){
    const a=nodes[e.a],b=nodes[e.b],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<65)continue;
    const inset=e.kind==="roundabout"?12:33;
    const p={x:a.x+dx*inset/len,y:a.y+dy*inset/len};
    const q={x:b.x-dx*inset/len,y:b.y-dy*inset/len};
    line(p,q,1.7,"#ffffffb8",[9,11]);
  }
  for(const n of nodes){
    if(n.control!=="light"&&n.control!=="stop")continue;
    for(const e of edges){
      const other=e.a===n.id?nodes[e.b]:e.b===n.id?nodes[e.a]:null;
      if(!other)continue;
      const angle=Math.atan2(other.y-n.y,other.x-n.x);
      ctx.save();ctx.translate(n.x+Math.cos(angle)*45,n.y+Math.sin(angle)*45);ctx.rotate(angle);
      for(let i=-2;i<=2;i++){ctx.fillStyle="#f5f6efc4";ctx.fillRect(i*7-2,-21,4,42)}
      ctx.restore();
    }
  }
}
function drawSigns(){
  for(const n of mapData.nodes){
    if(!n.control)continue;
    const x=n.x+25,y=n.y-24;
    if(n.control==="light"){
      const green=state?.lights?.[String(n.id)]??false;
      ctx.fillStyle="#1d2e2b";ctx.fillRect(x-7,y-10,14,20);
      ctx.fillStyle=green?"#62d486":"#e7695b";ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
    }else if(n.control==="stop"){
      ctx.fillStyle="#ad4e49";ctx.strokeStyle="#f8e4d3";ctx.lineWidth=2;ctx.beginPath();
      for(let i=0;i<8;i++){const a=i*Math.PI/4+Math.PI/8;const px=x+9*Math.cos(a),py=y+9*Math.sin(a);if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py)}
      ctx.closePath();ctx.fill();ctx.stroke();
    }else{
      ctx.fillStyle="#e8c96f";ctx.beginPath();ctx.moveTo(x,y+8);ctx.lineTo(x-8,y-6);ctx.lineTo(x+8,y-6);ctx.closePath();ctx.fill();
    }
  }
}
function drawCar(c,focus=false){
  ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.angle);
  ctx.fillStyle="#1c3d34aa";ctx.fillRect(-10,-7,27,15);
  ctx.fillStyle="#151a1a";ctx.fillRect(-10,-8,7,3);ctx.fillRect(7,-8,7,3);ctx.fillRect(-10,5,7,3);ctx.fillRect(7,5,7,3);
  ctx.fillStyle=colors[c.color];ctx.strokeStyle=focus?"#e5f39f":"#f4f5e6";ctx.lineWidth=focus?2:1;
  ctx.beginPath();ctx.roundRect(-14,-6,28,12,4);ctx.fill();ctx.stroke();
  ctx.fillStyle="#a6d2de";ctx.beginPath();ctx.roundRect(1,-4,6,8,1);ctx.fill();
  ctx.fillStyle="#fff8cb";ctx.fillRect(12,-4,2,3);ctx.fillRect(12,1,2,3);
  ctx.restore();
}
function interp(c){const old=previous?.cars.find(v=>v.id===c.id);if(!old)return c;const t=Math.min(1,(performance.now()-received)/180);return {...c,x:old.x+(c.x-old.x)*t,y:old.y+(c.y-old.y)*t,angle:old.angle+((c.angle-old.angle+Math.PI*3)%(Math.PI*2)-Math.PI)*t}}
function drawWorld(){
  const w=worldCanvas.clientWidth,h=worldCanvas.clientHeight;
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#58a877";ctx.fillRect(0,0,w,h);
  if(!mapData)return;
  const cars=state?.cars.map(interp)||[];
  const focus=cars.find(c=>c.id===0);
  if(camera.follow&&focus){camera.x+=(focus.x-camera.x)*.07;camera.y+=(focus.y-camera.y)*.07}
  ctx.save();ctx.translate(w/2-camera.x*camera.zoom,h/2-camera.y*camera.zoom);ctx.scale(camera.zoom,camera.zoom);
  ctx.fillStyle="#58a877";ctx.fillRect(0,0,mapData.width,mapData.height);
  ctx.fillStyle="#62ae7c";
  for(let i=0;i<10;i++){const x=(i*313+171)%mapData.width,y=(i*199+231)%mapData.height;ctx.beginPath();ctx.ellipse(x,y,140,80,i*.37,0,Math.PI*2);ctx.fill()}
  for(const b of buildings)drawBuilding(b);
  for(const tree of trees)drawTree(tree);
  drawRoads();drawSigns();
  if(focus&&state?.rays){
    ctx.lineWidth=2;ctx.strokeStyle="#419bdfb8";
    for(const ray of state.rays){ctx.beginPath();ctx.moveTo(focus.x,focus.y);ctx.lineTo(ray[0],ray[1]);ctx.stroke();ctx.fillStyle="#4eb9f5";ctx.beginPath();ctx.arc(ray[0],ray[1],3,0,Math.PI*2);ctx.fill()}
  }
  for(const car of cars)if(car.id!==0)drawCar(car);
  if(focus)drawCar(focus,true);
  ctx.restore();
}
function drawBrain(){
  const w=brainCanvas.clientWidth,h=brainCanvas.clientHeight;
  brainCtx.clearRect(0,0,w,h);brainCtx.fillStyle="#242a26";brainCtx.fillRect(0,0,w,h);
  const b=state?.brain;if(!b)return;
  const columns=[b.inputs,b.hidden,b.outputs],xs=[28,w/2,w-28];
  const ys=columns.map(col=>col.map((_,i)=>(i+1)*h/(col.length+1)));
  const weights=b.weights;
  for(let layer=0;layer<2;layer++){
    for(let to=0;to<columns[layer+1].length;to++){
      for(let from=0;from<columns[layer].length;from++){
        const index=layer===0?to*6+from:6*8+8+to*8+from;
        const v=weights[index];
        brainCtx.strokeStyle=v>=0?"rgba(235,197,80,"+Math.min(.8,.18+Math.abs(v)*1.1)+")":"rgba(77,140,230,"+Math.min(.8,.18+Math.abs(v)*1.1)+")";
        brainCtx.lineWidth=Math.min(2,.4+Math.abs(v));
        brainCtx.beginPath();brainCtx.moveTo(xs[layer],ys[layer][from]);brainCtx.lineTo(xs[layer+1],ys[layer+1][to]);brainCtx.stroke();
      }
    }
  }
  columns.forEach((col,k)=>col.forEach((v,i)=>{
    const x=xs[k],y=ys[k][i];brainCtx.fillStyle="#111915";brainCtx.beginPath();brainCtx.arc(x,y,8,0,Math.PI*2);brainCtx.fill();
    brainCtx.fillStyle=v>=0?"#e9cf6a":"#64a3db";brainCtx.globalAlpha=.25+Math.min(.75,Math.abs(v));
    brainCtx.beginPath();brainCtx.arc(x,y,5,0,Math.PI*2);brainCtx.fill();brainCtx.globalAlpha=1;
    brainCtx.strokeStyle="#b0beaf66";brainCtx.lineWidth=1;brainCtx.beginPath();brainCtx.arc(x,y,8,0,Math.PI*2);brainCtx.stroke();
  }));
}
function drawMini(){
  const w=miniCanvas.clientWidth,h=miniCanvas.clientHeight;
  miniCtx.clearRect(0,0,w,h);miniCtx.fillStyle="#202622";miniCtx.fillRect(0,0,w,h);
  if(!mapData)return;
  const scale=Math.min((w-24)/mapData.width,(h-24)/mapData.height);
  const ox=(w-mapData.width*scale)/2,oy=(h-mapData.height*scale)/2;
  miniCtx.save();miniCtx.beginPath();miniCtx.arc(w/2,h/2,Math.min(w,h)/2-2,0,Math.PI*2);miniCtx.clip();
  miniCtx.strokeStyle="#718276";miniCtx.lineWidth=1.1;
  for(const e of mapData.edges){const a=mapData.nodes[e.a],b=mapData.nodes[e.b];miniCtx.beginPath();miniCtx.moveTo(ox+a.x*scale,oy+a.y*scale);miniCtx.lineTo(ox+b.x*scale,oy+b.y*scale);miniCtx.stroke()}
  for(const car of state?.cars||[]){miniCtx.fillStyle=car.id===0?"#e6d164":colors[car.color];miniCtx.beginPath();miniCtx.arc(ox+car.x*scale,oy+car.y*scale,car.id===0?4:1.7,0,Math.PI*2);miniCtx.fill()}
  miniCtx.restore();
}
function frame(){drawWorld();drawBrain();drawMini();requestAnimationFrame(frame)}
async function update(){
  try{
    const r=await fetch("/api/state",{cache:"no-store"});if(!r.ok)throw Error();
    previous=state;state=await r.json();received=performance.now();
    document.getElementById("status").textContent="live · "+state.cars.length+" cars";
    document.querySelector(".corner").classList.remove("offline");
    const hours=Math.floor(state.elapsed/3600),minutes=Math.floor(state.elapsed%3600/60);
    document.getElementById("time").textContent=hours?hours+"h "+minutes+"m":minutes+"m";
    document.getElementById("cycles").textContent=state.cycles.toLocaleString();
    document.getElementById("best").textContent=state.best;
  }catch{document.getElementById("status").textContent="offline";document.querySelector(".corner").classList.add("offline")}
}
worldCanvas.addEventListener("wheel",e=>{e.preventDefault();camera.zoom=Math.max(.65,Math.min(2.1,camera.zoom*Math.exp(-e.deltaY*.001)))},{passive:false});
worldCanvas.addEventListener("pointerdown",e=>{dragging=true;lastPointer=[e.clientX,e.clientY];camera.follow=false;worldCanvas.setPointerCapture(e.pointerId)});
worldCanvas.addEventListener("pointermove",e=>{if(!dragging)return;camera.x-=(e.clientX-lastPointer[0])/camera.zoom;camera.y-=(e.clientY-lastPointer[1])/camera.zoom;lastPointer=[e.clientX,e.clientY]});
worldCanvas.addEventListener("pointerup",()=>dragging=false);
document.getElementById("follow").addEventListener("click",()=>camera.follow=true);
resize();frame();update();setInterval(update,180);
