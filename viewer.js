/* Offline, measured-data-only WebGL2 viewer. Coordinates remain developmental mm. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const M = window.SEED_MANIFEST;
  const canvas = $('view');
  const gl = canvas.getContext('webgl2', {antialias:true, alpha:false, preserveDrawingBuffer:true});
  if (!gl) { $('error').style.display='grid'; $('error').textContent='WebGL 2 is unavailable. Please open this page in a browser with WebGL 2 enabled.'; $('loading').hidden=true; return; }
  const size = M.gridShape, total = size[0]*size[1]*size[2];
  const lo = M.bounds[0], hi = M.bounds[1], extent = hi.map((v,i)=>v-lo[i]);
  const center = lo.map((v,i)=>(v+hi[i])/2);
  const groups=M.groups, colors=['#dce3e8',...groups.map(g=>g.color),'#a8c9df'];
  const V = {
    add:(a,b)=>a.map((x,i)=>x+b[i]), sub:(a,b)=>a.map((x,i)=>x-b[i]),
    mul:(a,s)=>a.map(x=>x*s), dot:(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),
    cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
    norm:a=>{const d=Math.hypot(...a)||1;return a.map(x=>x/d);}
  };
  const rgb=h=>[1,3,5].map(k=>parseInt(h.slice(k,k+2),16)/255);
  const state={focus:'group0',layer:'effect',body:'physical',cut:'off',direction:'y',depth:-12,azimuth:45,elevation:20,flip:1,thickness:12,opacity:.95,hardware:true,lines:false,guide:true};
  const camera={target:[...center],yaw:.72,pitch:.57,distance:Math.max(...extent)*1.8};
  const pending=new Map(), cache=new Map(); let base, current, scalar, known;
  let bodyMesh, hardwareMeshes=[], planeMesh, frameMesh, materialTex, scalarTex, knownTex;
  let viewProjection, viewMatrix, eye, currentNormal=[0,1,0], planePoint, revision=0;
  let needRender=false, isLoading=true, legendMax=1, colorMode=1, selectedGenes=[];
  const audit={frame:0,lastError:null,loadedKeys:[],selected:null};

  async function inflate(text,type) {
    const bytes=Uint8Array.from(atob(text),x=>x.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buffer=await new Response(stream).arrayBuffer();
    return type==='f32'?new Float32Array(buffer):type==='u16'?new Uint16Array(buffer):new Uint8Array(buffer);
  }
  window.SEED_DATA={receive(key,obj){const p=pending.get(key);if(p){pending.delete(key);p.resolve(obj);}}};
  async function data(key) {
    if(cache.has(key)){const p=cache.get(key);if(key!=='base'){cache.delete(key);cache.set(key,p);}return p;}
    const promise=new Promise((resolve,reject)=>{
      pending.set(key,{resolve,reject});
      const script=document.createElement('script');script.src=`data/${key}.js`;
      script.onerror=()=>{pending.delete(key);script.remove();reject(new Error('Could not load dataset: '+key));};
      script.onload=()=>script.remove();document.head.append(script);
    }).then(async raw=>{
      const obj={...raw};
      const u8=['physical','physicalLabels','raw','rawLabels','categories','loss','added','ko'];
      const f32=['hm','hj','products','dhm','dhj'];
      await Promise.all(Object.keys(raw).map(async k=>{
        if(u8.includes(k))obj[k]=await inflate(raw[k],'u8');
        else if(f32.includes(k))obj[k]=await inflate(raw[k],'f32');
        else if(k==='productCoordinates')obj[k]=await inflate(raw[k],'u16');
      }));
      audit.loadedKeys.push(key); return obj;
    });
    cache.set(key,promise);
    const keys=[...cache.keys()].filter(k=>k!=='base');while(keys.length>4)cache.delete(keys.shift());
    return promise;
  }

  const vert=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPosition; layout(location=1) in vec3 aNormal;
  uniform mat4 uVP;out vec3 world;out vec3 normal;
  void main(){world=aPosition;normal=aNormal;gl_Position=uVP*vec4(aPosition,1.);}`;
  const frag=`#version 300 es
  precision highp float;precision highp sampler3D;
  in vec3 world;in vec3 normal;out vec4 outColor;
  uniform sampler3D uMask;uniform sampler3D uScalar;uniform sampler3D uKnown;
  uniform vec3 uLo;uniform vec3 uExtent;uniform vec3 uCutNormal;uniform vec3 uSolidColor;
  uniform float uDepth;uniform float uThickness;uniform float uOpacity;uniform float uMax;uniform float uFlip;
  uniform int uCutMode;uniform int uPlane;uniform int uSolid;uniform int uColorMode;uniform int uLines;
  vec3 category(float a){int i=int(floor(a+.5));
    if(i==1)return vec3(.153,.486,.569);if(i==2)return vec3(.518,.400,.651);
    if(i==3)return vec3(.267,.451,.682);if(i==4)return vec3(.776,.580,.208);
    if(i==5)return vec3(.298,.584,.459);if(i==6)return vec3(.671,.447,.380);
    if(i==7)return vec3(.659,.788,.875);return vec3(.84,.87,.89);}
  void main(){
    float distanceToPlane=(dot(world,uCutNormal)-uDepth)*uFlip;
    if(uPlane==0 && uCutMode==1 && distanceToPlane>.12)discard;
    if(uPlane==0 && uCutMode==2 && abs(distanceToPlane)>uThickness*.5)discard;
    vec3 q=(world-uLo)/uExtent;
    if(uSolid==0 && (any(lessThan(q,vec3(0)))||any(greaterThan(q,vec3(1)))))discard;
    vec3 c=uSolidColor;float alpha=uOpacity;
    if(uSolid==0){
      float occupancy=texture(uMask,q).r;
      if(uPlane==1 && occupancy<.5 && uColorMode<4)discard;
      float a=texture(uScalar,q).r;float valid=texture(uKnown,q).r;
      if(uPlane==1 && uColorMode==4 && valid<.5)discard;
      c=vec3(.83,.86,.88);
      if(uColorMode==1){if(a>.5)c=vec3(.153,.486,.569);if(a<-.5)c=vec3(.776,.580,.208);}
      if(uColorMode==2)c=category(a);
      if(uColorMode==3){if(a>.5&&a<1.5)c=vec3(.78,.64,.39);else if(a>1.5&&a<2.5)c=vec3(.48,.66,.69);else if(a>2.5)c=vec3(.58,.54,.69);}
      if(uColorMode==4){float f=clamp(a/max(uMax,.0000001),0.,1.);c=mix(vec3(.93,.96,.97),vec3(.13,.46,.57),f);if(valid<.5)c=vec3(.82,.83,.84);}
      if(uColorMode==5){float f=clamp(abs(a)/max(uMax,.0000001),0.,1.);c=mix(vec3(.96,.96,.95),a>=0.?vec3(.68,.22,.29):vec3(.13,.40,.61),sqrt(f));}
      if(uPlane==1){alpha=.98;if(occupancy<.5)alpha=.74;}
      if(uLines==1){
        vec3 cell=fract((world+vec3(486.))/12.);vec3 e=min(cell,1.-cell);
        vec3 n=abs(normal);float line;
        if(uPlane==1)line=min(e.x,min(e.y,e.z));
        else if(n.x>.5)line=min(e.y,e.z);else if(n.y>.5)line=min(e.x,e.z);else line=min(e.x,e.y);
        c*=mix(.77,1.,smoothstep(.015,.045,line));
      }
    }
    vec3 n=normalize(normal);float light=uPlane==1?1.:(.61+.25*abs(dot(n,normalize(vec3(.7,.4,1.))))+.14*max(0.,dot(n,normalize(vec3(-.4,-.9,.5)))));
    outColor=vec4(c*light,alpha);
  }`;
  function shader(type,code){const s=gl.createShader(type);gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vert));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,frag));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  const uniforms=Object.fromEntries(['VP','Lo','Extent','CutNormal','SolidColor','Depth','Thickness','Opacity','Max','Flip','CutMode','Plane','Solid','ColorMode','Lines','Mask','Scalar','Known'].map(k=>[k,gl.getUniformLocation(program,'u'+k)]));
  gl.useProgram(program);gl.uniform1i(uniforms.Mask,0);gl.uniform1i(uniforms.Scalar,1);gl.uniform1i(uniforms.Known,2);
  gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);gl.clearColor(.969,.969,.980,1);
  function texture(values,isFloat=false){
    const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,p,gl.NEAREST);
    for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.CLAMP_TO_EDGE);
    gl.texImage3D(gl.TEXTURE_3D,0,isFloat?gl.R32F:gl.R8,...size,0,gl.RED,isFloat?gl.FLOAT:gl.UNSIGNED_BYTE,values);
    return t;
  }
  function replaceTexture(old,values,isFloat=false){if(old)gl.deleteTexture(old);return texture(values,isFloat);}
  function mesh(vertices,primitive=gl.TRIANGLES){
    const vao=gl.createVertexArray();gl.bindVertexArray(vao);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);return{vao,buffer,count:vertices.length/6,primitive};
  }
  function dispose(m){if(m){gl.deleteBuffer(m.buffer);gl.deleteVertexArray(m.vao);}}
  function boundary(mask){
    const out=[],nx=size[0],ny=size[1],nz=size[2],row=nx,slab=nx*ny;
    const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
    const triangles=[0,1,2,0,2,3];
    for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const idx=x+y*row+z*slab;if(!mask[idx])continue;
      const c=[lo[0]+6+x*12,lo[1]+6+y*12,lo[2]+6+z*12];
      for(const n of directions){
        const xx=x+n[0],yy=y+n[1],zz=z+n[2];
        if(xx>=0&&xx<nx&&yy>=0&&yy<ny&&zz>=0&&zz<nz&&mask[xx+yy*row+zz*slab])continue;
        const axis=n.findIndex(v=>v!==0),others=[0,1,2].filter(v=>v!==axis),corners=[[-1,-1],[1,-1],[1,1],[-1,1]];
        for(const k of triangles){const v=[...c];v[axis]+=n[axis]*6;v[others[0]]+=corners[k][0]*6;v[others[1]]+=corners[k][1]*6;out.push(...v,...n);}
      }
    }
    return new Float32Array(out);
  }
  function perspective(fov,aspect,near,far){const f=1/Math.tan(fov/2),nf=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);}
  function lookAt(e,t){const z=V.norm(V.sub(e,t)),x=V.norm(V.cross([0,0,1],z)),y=V.cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-V.dot(x,e),-V.dot(y,e),-V.dot(z,e),1]);}
  function multiply(a,b){const c=new Float32Array(16);for(let j=0;j<4;j++)for(let i=0;i<4;i++)for(let k=0;k<4;k++)c[j*4+i]+=a[k*4+i]*b[j*4+k];return c;}
  function project(p){const m=viewProjection;const w=m[3]*p[0]+m[7]*p[1]+m[11]*p[2]+m[15];return[(m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12])/w*canvas.clientWidth/2+canvas.clientWidth/2,canvas.clientHeight/2-(m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13])/w*canvas.clientHeight/2];}
  function normal(){
    if(state.direction==='x')return[1,0,0];if(state.direction==='y')return[0,1,0];if(state.direction==='z')return[0,0,1];
    const a=state.azimuth*Math.PI/180,e=state.elevation*Math.PI/180;return[Math.cos(e)*Math.cos(a),Math.cos(e)*Math.sin(a),Math.sin(e)];
  }
  function updatePlane(updateRange=false){
    currentNormal=normal();const n=currentNormal;
    const corners=[];for(const x of [lo[0],hi[0]])for(const y of [lo[1],hi[1]])for(const z of [lo[2],hi[2]])corners.push(V.dot(n,[x,y,z]));
    if(updateRange){$('depth').min=Math.ceil(Math.min(...corners));$('depth').max=Math.floor(Math.max(...corners));state.depth=Math.max(+$('depth').min,Math.min(+$('depth').max,state.depth));}
    $('view').dataset.cut=state.cut;$('view').dataset.direction=state.direction;$('view').dataset.depth=String(state.depth);$('depth').value=state.depth;$('depthValue').textContent=Math.round(state.depth)+' mm';
    planePoint=V.add(center,V.mul(n,state.depth-V.dot(n,center)));
    const u=V.norm(V.cross(n,Math.abs(n[2])<.9?[0,0,1]:[0,1,0])),v=V.cross(n,u),verts=[];
    for(let axis=0;axis<3;axis++){
      const others=[0,1,2].filter(k=>k!==axis);
      for(let a=0;a<2;a++)for(let b=0;b<2;b++){
        const p=[...lo];p[others[0]]=a?hi[others[0]]:lo[others[0]];p[others[1]]=b?hi[others[1]]:lo[others[1]];
        const q=[...p];q[axis]=hi[axis];const da=V.dot(n,p)-state.depth,db=V.dot(n,q)-state.depth;
        if(Math.abs(da-db)<1e-10)continue;
        const t=da/(da-db);if(t<0||t>1)continue;
        const point=V.add(p,V.mul(V.sub(q,p),t));if(!verts.some(x=>Math.hypot(...V.sub(x,point))<1e-6))verts.push(point);
      }
    }
    if(verts.length)planePoint=verts.reduce((a,b)=>V.add(a,b),[0,0,0]).map(x=>x/verts.length);
    verts.sort((a,b)=>Math.atan2(V.dot(V.sub(a,planePoint),v),V.dot(V.sub(a,planePoint),u))-Math.atan2(V.dot(V.sub(b,planePoint),v),V.dot(V.sub(b,planePoint),u)));
    const list=[];for(let j=1;j<verts.length-1;j++)for(const i of [0,j,j+1])list.push(...verts[i],...n);dispose(planeMesh);planeMesh=mesh(new Float32Array(list));
    const frame=[];for(let i=0;i<verts.length;i++)frame.push(...verts[i],...n,...verts[(i+1)%verts.length],...n);dispose(frameMesh);frameMesh=mesh(new Float32Array(frame),gl.LINES);
    $('angles').hidden=state.direction!=='free';$('sliceControls').hidden=state.cut==='off';requestRender();
  }
  function draw(m,solid=false,color=[.5,.5,.5],plane=false,opacity=1){
    if(!m)return;gl.uniform1i(uniforms.Solid,solid?1:0);gl.uniform3fv(uniforms.SolidColor,color);gl.uniform1i(uniforms.Plane,plane?1:0);gl.uniform1f(uniforms.Opacity,opacity);gl.bindVertexArray(m.vao);gl.drawArrays(m.primitive,0,m.count);
  }
  function render(){
    needRender=false;if(!base)return;
    const dpr=Math.min(devicePixelRatio||1,2),w=Math.round(canvas.clientWidth*dpr),h=Math.round(canvas.clientHeight*dpr);
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}gl.viewport(0,0,w,h);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const fittedDistance=camera.distance*Math.max(1,.95/(w/h));
    eye=V.add(camera.target,[fittedDistance*Math.cos(camera.pitch)*Math.cos(camera.yaw),fittedDistance*Math.cos(camera.pitch)*Math.sin(camera.yaw),fittedDistance*Math.sin(camera.pitch)]);
    viewMatrix=lookAt(eye,camera.target);viewProjection=multiply(perspective(Math.PI/4,w/h,10,18000),viewMatrix);
    gl.useProgram(program);gl.uniformMatrix4fv(uniforms.VP,false,viewProjection);gl.uniform3fv(uniforms.Lo,lo);gl.uniform3fv(uniforms.Extent,extent);
    gl.uniform3fv(uniforms.CutNormal,currentNormal);gl.uniform1f(uniforms.Depth,state.depth);gl.uniform1f(uniforms.Thickness,state.thickness);gl.uniform1f(uniforms.Flip,state.flip);
    gl.uniform1i(uniforms.CutMode,state.cut==='cut'?1:state.cut==='slab'?2:0);gl.uniform1i(uniforms.ColorMode,colorMode);gl.uniform1f(uniforms.Max,legendMax);gl.uniform1i(uniforms.Lines,state.lines?1:0);
    for(const [i,t] of [materialTex,scalarTex,knownTex].entries()){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_3D,t);}
    gl.depthMask(true);
    if(state.cut!=='plane')draw(bodyMesh,false,[0,0,0],false,state.opacity);
    if(state.hardware&&state.body==='physical'&&state.cut!=='plane')for(const m of hardwareMeshes)draw(m.mesh,true,m.color,false,1);
    if(state.cut!=='off'){
      gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(-1,-1);draw(planeMesh,false,[0,0,0],true,1);gl.disable(gl.POLYGON_OFFSET_FILL);
      if(state.guide){gl.depthMask(false);draw(frameMesh,true,[.62,.72,.77],true,.25);gl.depthMask(true);}
    }
    const handle=$('sliceHandle');handle.hidden=state.cut==='off'||!state.guide;
    if(!handle.hidden){const p=project(planePoint);handle.style.left=p[0]+'px';handle.style.top=p[1]+'px';}
    const axes=[[1,0,0],[0,1,0],[0,0,1]],labels=['X','Y','Z'];let html='';
    axes.forEach((a,i)=>{const x=(viewMatrix[0]*a[0]+viewMatrix[4]*a[1]+viewMatrix[8]*a[2])*26,y=-(viewMatrix[1]*a[0]+viewMatrix[5]*a[1]+viewMatrix[9]*a[2])*26;html+=`<line x1="40" y1="40" x2="${40+x}" y2="${40+y}" stroke="#92a4ad"/><text x="${40+x*1.2}" y="${43+y*1.2}" text-anchor="middle">${labels[i]}</text>`;});$('axis').innerHTML=html;
    const err=gl.getError();if(err){audit.lastError=err;console.error('WebGL error',err);}audit.frame++;$('view').dataset.renderFrame=String(audit.frame);$('view').dataset.renderError=audit.lastError||'';
  }
  function requestRender(){if(!needRender){needRender=true;requestAnimationFrame(render);}}

  function focusGenes(){if(state.focus==='all')return[];if(state.focus.startsWith('gene'))return[+state.focus.slice(4)];return groups[+state.focus.slice(5)].genes;}
  function focusName(){if(state.focus==='all')return'All measured groups';if(state.focus.startsWith('gene'))return M.nodes[+state.focus.slice(4)].alias;const g=groups[+state.focus.slice(5)];return g.id+' · '+g.genes.map(i=>M.nodes[i].alias).join(' + ');}
  async function update(){
    const token=++revision;isLoading=true;$('focus').classList.add('selection-spinner');
    if(!base)base=await data('base');
    selectedGenes=focusGenes();updateGraph();let selected=null;
    if(state.focus!=='all')selected=await data(state.focus);
    if(token!==revision)return;current=selected;
    let mask=state.body==='raw'?base.raw:state.body==='ko'?(current?current.ko:base.raw):base.physical;
    if(state.body==='ko'&&!current){state.body='raw';$('bodyKind').value='raw';}
    materialTex=replaceTexture(materialTex,Uint8Array.from(mask,v=>v?255:0));dispose(bodyMesh);bodyMesh=mesh(boundary(mask));
    scalar=new Float32Array(total);known=Uint8Array.from(base.raw,v=>v?255:0);legendMax=1;
    if(state.layer==='effect'){
      if(!current){scalar=Float32Array.from(base.categories);colorMode=2;}
      else{for(let i=0;i<total;i++)scalar[i]=current.loss[i]?1:current.added[i]?-1:0;colorMode=1;}
    }else if(state.layer==='regions'){scalar=Float32Array.from(state.body==='physical'?base.physicalLabels:base.rawLabels);colorMode=3;}
    else if(state.layer==='hm'||state.layer==='hj'){scalar=base[state.layer];known.fill(255);colorMode=4;}
    else if(state.layer==='dhm'||state.layer==='dhj'){
      if(!current){$('focus').value='group0';state.focus='group0';return update();}
      scalar=current[state.layer];known.fill(255);legendMax=M.deltaMax[state.layer==='dhm'?0:1];colorMode=5;
    }else{
      const ids=selectedGenes.length?selectedGenes:M.nodes.map((_,i)=>i);const samples=base.productCoordinates.length/3;
      for(let p=0;p<samples;p++){
        const x=base.productCoordinates[p*3]-M.cropLow[0],y=base.productCoordinates[p*3+1]-M.cropLow[1],z=base.productCoordinates[p*3+2]-M.cropLow[2];
        if(x<0||y<0||z<0||x>=size[0]||y>=size[1]||z>=size[2])continue;
        let val=0;for(const id of ids)val+=base.products[id*samples+p];scalar[x+y*size[0]+z*size[0]*size[1]]=val;
      }
      legendMax=0;for(const v of scalar)if(v>legendMax)legendMax=v;legendMax=Math.max(legendMax,1e-9);colorMode=4;
    }
    scalarTex=replaceTexture(scalarTex,scalar,true);knownTex=replaceTexture(knownTex,known);
    isLoading=false;$('focus').classList.remove('selection-spinner');$('loading').hidden=true;
    const kind=state.body==='physical'?'WT assembled body':state.body==='raw'?'WT raw material':'KO raw material';
    let text=focusName()+' · '+kind;
    if(state.layer==='effect'&&current)text+=` · ${current.lostCount.toLocaleString()} voxels lost`;
    if(state.body==='ko'&&current&&!current.assembled)text+=' · Assembly failed';
    $('status').textContent=text;$('view').dataset.selection=state.focus;$('view').dataset.layer=state.layer;$('view').dataset.body=state.body;
    $('caption').textContent=state.layer==='product'?'WT products are sampled inside WT material only. Gray = no saved sample.':(state.layer==='hm'||state.layer==='hj'||state.layer==='dhm'||state.layer==='dhj')?'Field crop: all measured bodies + 36 mm margin. Coordinates in mm.':'';
    legend();requestRender();audit.selected={...state,genes:selectedGenes.map(i=>M.nodes[i].alias)};
  }
  function swatches(items){return'<div class="swatches">'+items.map(([c,t])=>`<span><i style="background:${c}"></i>${t}</span>`).join('')+'</div>';}
  function legend(){
    let title='',content='';
    if(state.layer==='effect'&&!current){title='Measured material dependence';content=swatches([['#a8c9df','Shared'],['#dce3e8','No measured loss'],...groups.map(g=>[g.color,g.id+' only'])]);}
    else if(state.layer==='effect'){title='Material response to production KO';content=swatches([['#277c91','Lost from WT'],['#dce3e8','Retained'],['#c69435','Added in KO view']]);}
    else if(state.layer==='regions'){title='Fixed WT body regions';content=swatches([['#c6a263','B1'],['#7aa8af','B2'],['#938aaf','B3']]);}
    else{
      const delta=state.layer.startsWith('d');
      title=state.layer==='product'?(selectedGenes.length===1?'WT gene product c':'WT selected products Σc'):({hm:'WT Hm',hj:'WT Hj',dhm:'ΔHm = KO − WT',dhj:'ΔHj = KO − WT'}[state.layer]);
      content=`<div class="colorbar" style="background:${delta?'linear-gradient(to right,#21669c,#f4f4f2,#ae384a)':'linear-gradient(to right,#edf5f7,#217592)'}"></div><div class="legend-range"><span>${delta?(-legendMax).toPrecision(3):'0'}</span><span>${legendMax.toPrecision(3)}</span></div>`;
    }
    $('legend').innerHTML='<div class="legend-title">'+title+'</div>'+content;
  }
  function graph(){
    const svg=$('graph'),n=M.nodes.length;
    const xy=M.nodes.map((_,i)=>{const a=-Math.PI/2+i*2*Math.PI/n;return[165+112*Math.cos(a),165+112*Math.sin(a)];});
    let html='<defs><marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#8a9faa"/></marker><marker id="inhibit" markerWidth="7" markerHeight="9" refX="3" refY="4.5" orient="auto"><path d="M3,0 L3,9" stroke="#8a9faa" stroke-width="1.5"/></marker></defs>';
    M.edges.forEach((edge,i)=>{
      const a=xy[edge.source],b=xy[edge.target];let d;
      if(edge.source===edge.target)d=`M${a[0]-4},${a[1]-3} C${a[0]-28},${a[1]-29} ${a[0]+27},${a[1]-29} ${a[0]+5},${a[1]-3}`;
      else{const v=V.norm([b[0]-a[0],b[1]-a[1],0]);d=`M${a[0]+v[0]*7},${a[1]+v[1]*7} Q165,165 ${b[0]-v[0]*10},${b[1]-v[1]*10}`;}
      html+=`<path data-edge="${i}" class="edge" d="${d}" marker-end="url(#${edge.weight>0?'arrow':'inhibit'})" ${edge.weight<0?'stroke-dasharray="3 2"':''}/>`;
    });
    M.nodes.forEach((node,i)=>{
      const [x,y]=xy[i],dx=(x-165)/112,dy=(y-165)/112,anchor=dx>.15?'start':dx<-.15?'end':'middle';
      html+=`<g class="node" data-gene="${i}" role="button" tabindex="0" aria-label="Select gene ${node.alias}"><title>${node.alias}: show measured single-gene KO</title><circle cx="${x}" cy="${y}" r="6"/><text x="${x+dx*13}" y="${y+dy*13+4}" text-anchor="${anchor}">${node.alias}</text></g>`;
    });svg.innerHTML=html;
    svg.querySelectorAll('[data-gene]').forEach(g=>{
      const activate=()=>{state.focus='gene'+g.dataset.gene;$('focus').value=state.focus;update().catch(fail);};
      g.addEventListener('click',activate);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});
    });
  }
  function updateGraph(){
    $('graph').querySelectorAll('[data-gene]').forEach(g=>g.classList.toggle('active',selectedGenes.includes(+g.dataset.gene)));
    $('graph').querySelectorAll('[data-edge]').forEach(g=>{const e=M.edges[+g.dataset.edge];g.classList.toggle('active',selectedGenes.includes(e.source)||selectedGenes.includes(e.target));});
  }
  function fail(error){audit.lastError=String(error);console.error(error);$('loading').textContent=String(error);$('loading').hidden=false;}

  $('focus').innerHTML='<option value="all">All measured groups</option>'+groups.map((g,i)=>`<option value="group${i}">${g.id} · ${g.genes.map(k=>M.nodes[k].alias).join(' + ')}</option>`).join('')+'<optgroup label="Single genes">'+M.nodes.map((n,i)=>`<option value="gene${i}">${n.alias}</option>`).join('')+'</optgroup>';$('focus').value=state.focus;
  for(const [id,key] of [['layer','layer'],['focus','focus'],['bodyKind','body']])$(id).addEventListener('change',()=>{state[key]=$(id).value;update().catch(fail);});
  $('cutMode').addEventListener('change',()=>{state.cut=$('cutMode').value;updatePlane();});
  $('direction').addEventListener('change',()=>{state.direction=$('direction').value;state.flip=1;updatePlane(true);});
  $('depth').addEventListener('input',()=>{state.depth=+$('depth').value;updatePlane();});
  for(const id of ['azimuth','elevation'])$(id).addEventListener('input',()=>{state[id]=+$(id).value;updatePlane(true);});
  $('flip').addEventListener('click',()=>{state.flip*=-1;requestRender();});
  $('opacity').addEventListener('input',()=>{state.opacity=+$('opacity').value/100;requestRender();});
  $('thickness').addEventListener('input',()=>{state.thickness=+$('thickness').value;$('thicknessValue').textContent=state.thickness+' mm';requestRender();});
  for(const [id,key] of [['hardware','hardware'],['voxelEdges','lines'],['planeGuide','guide']])$(id).addEventListener('change',()=>{state[key]=$(id).checked;requestRender();});
  $('options').addEventListener('click',()=>{const open=$('settings').classList.toggle('open');$('options').setAttribute('aria-expanded',open);});
  $('graphToggle').addEventListener('click',()=>{const closed=$('graphPanel').classList.toggle('collapsed');$('graphToggle').textContent=closed?'Show':'Hide';$('graphToggle').setAttribute('aria-expanded',!closed);});
  $('reset').addEventListener('click',()=>{camera.target=[...center];camera.yaw=.72;camera.pitch=.57;camera.distance=Math.max(...extent)*1.8;requestRender();});
  const pointers=new Map();let previousPinch=0;
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('pointerdown',e=>{if(!viewMatrix)return;canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,button:e.button});if(pointers.size===2){const a=[...pointers.values()];previousPinch=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);}});
  canvas.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;const p=pointers.get(e.pointerId),dx=e.clientX-p.x,dy=e.clientY-p.y;
    if(pointers.size===2){pointers.set(e.pointerId,{...p,x:e.clientX,y:e.clientY});const a=[...pointers.values()],d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);if(previousPinch)camera.distance*=previousPinch/d;previousPinch=d;}
    else if(e.shiftKey&&state.cut!=='off'){state.depth=Math.max(+$('depth').min,Math.min(+$('depth').max,state.depth-dy*camera.distance/canvas.clientHeight));updatePlane();}
    else if(p.button===2||p.button===1){const ratio=camera.distance/canvas.clientHeight*.8,right=[viewMatrix[0],viewMatrix[4],viewMatrix[8]],up=[viewMatrix[1],viewMatrix[5],viewMatrix[9]];camera.target=V.add(camera.target,V.add(V.mul(right,-dx*ratio),V.mul(up,dy*ratio)));}
    else{camera.yaw-=dx*.007;camera.pitch=Math.max(-1.50,Math.min(1.50,camera.pitch+dy*.007));}
    pointers.set(e.pointerId,{...p,x:e.clientX,y:e.clientY});requestRender();
  });
  const release=e=>{pointers.delete(e.pointerId);previousPinch=0;};canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  canvas.addEventListener('wheel',e=>{e.preventDefault();camera.distance=Math.max(90,Math.min(8000,camera.distance*Math.exp(e.deltaY*.001)));requestRender();},{passive:false});
  let dragging=null;
  $('sliceHandle').addEventListener('pointerdown',e=>{e.preventDefault();$('sliceHandle').setPointerCapture(e.pointerId);dragging={y:e.clientY,depth:state.depth};});
  $('sliceHandle').addEventListener('pointermove',e=>{if(!dragging)return;const ratio=Math.max(...extent)/Math.max(280,canvas.clientHeight*.65);state.depth=Math.max(+$('depth').min,Math.min(+$('depth').max,dragging.depth-(e.clientY-dragging.y)*ratio));updatePlane();});
  $('sliceHandle').addEventListener('pointerup',()=>dragging=null);$('sliceHandle').addEventListener('pointercancel',()=>dragging=null);
  new ResizeObserver(()=>requestRender()).observe(canvas);
  window.addEventListener('error',e=>{audit.lastError=e.message;});
  window.addEventListener('unhandledrejection',e=>fail(e.reason));
  window.SEED_VIEWER_AUDIT=()=>({...audit,state:{...state},gridShape:size,loading:isLoading,bodyTriangles:bodyMesh?bodyMesh.count/3:0,planeVertices:planeMesh?planeMesh.count:0,planeNormal:[...currentNormal],planeCenter:planePoint?[...planePoint]:null,cachedCases:cache.size,canvasSize:[canvas.width,canvas.height],webglVersion:gl.getParameter(gl.VERSION)});
  (async()=>{
    graph();base=await data('base');
    await Promise.all(M.hardware.map(async h=>{const v=await inflate(h.vertices,'f32');hardwareMeshes.push({mesh:mesh(v),color:rgb(h.color)});}));
    updatePlane(true);await update();
  })().catch(fail);
})();
