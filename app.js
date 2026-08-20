const DB='alok-reader-v2'; const STORE='books'; let db,books=[],screen='library',query='',current=null,pageIndex=0,totalPages=1,rawReadingHtml='';
const $=s=>document.querySelector(s);
function uid(){return crypto.randomUUID?.()||String(Date.now()+Math.random())}
function openDB(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'id'});r.onsuccess=()=>{db=r.result;res()};r.onerror=()=>rej(r.error)})}
function all(){return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function put(x){return new Promise((res,rej)=>{const r=db.transaction(STORE,'readwrite').objectStore(STORE).put(x);r.onsuccess=res;r.onerror=()=>rej(r.error)})}
function safe(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function titleOf(b){return b.title||b.name.replace(/\.pdf$/i,'')}
function escapeHtml(s){return safe(s)}
function paragraphsFromText(text){
  text=text.replace(/\r/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n');
  const raw=text.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean);
  let out='';
  for(const block of raw){
    const lines=block.split('\n').map(x=>x.trim()).filter(Boolean);
    const joined=lines.join(' ');
    if(/^((chapter|part|section)\s+[\w\dIVXLC]+)/i.test(joined)||(/^[A-Z][A-Z0-9\s:,&'’\-]{5,80}$/.test(joined)&&joined.length<90)){
      out+=`<h2>${escapeHtml(joined)}</h2>`;
    }else if(joined.length<90 && (/^(preface|introduction|conclusion|background|contents|acknowledg(e)?ments?)$/i.test(joined))){
      out+=`<h2>${escapeHtml(joined)}</h2>`;
    }else{
      out+=`<p>${escapeHtml(joined)}</p>`;
    }
  }
  return out;
}
function renderLibrary(){
  const filtered=books.filter(b=>!query||titleOf(b).toLowerCase().includes(query.toLowerCase())||(b.author||'').toLowerCase().includes(query.toLowerCase()));
  const active=books.find(b=>b.progress>0)||books[0];
  $('#content').innerHTML=`<div class="hero"><div><h1>Good reading starts here.</h1><p>Your personal books, redesigned for comfortable reading.</p></div><div><div class="stat">${books.length}</div><div style="color:#d1d5db">books</div></div></div>
  ${active?`<div class="section-head"><h2>Continue Reading</h2></div><div class="continue-card" data-open="${active.id}"><div class="cover">${escapeHtml(titleOf(active))}</div><div class="continue-info"><h3>${escapeHtml(titleOf(active))}</h3><div class="muted">${escapeHtml(active.author||'Personal book')}</div><div class="continue-progress progress"><i style="width:${Math.max(1,Math.round((active.progress||0)*100))}%"></i></div><div class="muted">${Math.round((active.progress||0)*100)}% complete · ${active.lastPage||0} of ${active.totalPages||'—'} pages</div><div style="margin-top:14px"><button class="btn primary">Continue reading →</button></div></div></div>`:''}
  <div class="section-head"><h2>Your Library</h2><button id="add" class="btn primary">＋ Add PDF</button></div>
  ${filtered.length?`<div class="book-grid">${filtered.map(b=>`<article class="book-card" data-open="${b.id}"><div class="book-cover">${escapeHtml(titleOf(b))}</div><div class="book-title">${escapeHtml(titleOf(b))}</div><div class="book-meta"><span>${escapeHtml(b.author||'Personal book')}</span><span>${Math.round((b.progress||0)*100)}%</span></div><div class="progress book-progress"><i style="width:${Math.max(0,Math.round((b.progress||0)*100))}%"></i></div></article>`).join('')}</div>`:`<div class="empty"><h3>Your library is empty</h3><p>Add a PDF. Alok Reader will extract the text and turn it into a reflowable reading experience.</p><button id="emptyAdd" class="btn primary">Add your first book</button></div>`}`;
  $('#add')?.addEventListener('click',openFilePicker);$('#emptyAdd')?.addEventListener('click',openFilePicker);
  document.querySelectorAll('[data-open]').forEach(e=>e.addEventListener('click',()=>openBook(e.dataset.open)));
}
function renderCollections(){const names=['All Books','Business','Finance','Self Help','Technology','Biography','Fiction'];$('#content').innerHTML=`<div class="section-head"><h2>Collections</h2></div><div class="cards">${names.map((n,i)=>`<div class="info-card"><h3>${n}</h3><p class="muted">${i===0?books.length:0} books</p></div>`).join('')}</div>`}
function renderBookmarks(){
  const rows=books.flatMap(b=>(b.bookmarks||[]).map(p=>({b,p})));
  let html='<div class="section-head"><h2>Bookmarks</h2></div>';
  if(rows.length){
    html+='<div class="list">';
    html+=rows.map(x=>`<div class="list-row"><span>🔖</span><div class="grow"><strong>${escapeHtml(titleOf(x.b))}</strong><div class="muted">Reading position ${x.p}%</div></div><button class="btn" data-open="${x.b.id}">Open</button></div>`).join('');
    html+='</div>';
  }else{
    html+='<div class="empty">No bookmarks yet.</div>';
  }
  $('#content').innerHTML=html;
  document.querySelectorAll('[data-open]').forEach(e=>e.addEventListener('click',()=>openBook(e.dataset.open)));
}
function renderHighlights(){
  const rows=books.flatMap(b=>(b.highlights||[]).map(h=>({b,h})));
  let html='<div class="section-head"><h2>Highlights & Notes</h2></div>';
  if(rows.length){
    html+='<div class="list">';
    html+=rows.map(x=>`<div class="list-row highlight-row" data-open="${x.b.id}" data-page="${Number(x.h.page)||0}">
      <span>🟨</span>
      <div class="grow">
        <strong>${escapeHtml(titleOf(x.b))}</strong>
        <div class="highlight-quote">${escapeHtml(x.h.text)}</div>
        ${x.h.note?`<div class="highlight-note">📝 ${escapeHtml(x.h.note)}</div>`:''}
        <div class="muted">Page ${Number(x.h.page||0)+1}</div>
      </div>
      <button class="btn" data-open-highlight="${x.b.id}" data-page="${Number(x.h.page)||0}">Open</button>
    </div>`).join('');
    html+='</div>';
  }else{
    html+='<div class="empty">Select text while reading and choose Highlight or Note.</div>';
  }
  $('#content').innerHTML=html;
  document.querySelectorAll('[data-open-highlight]').forEach(e=>e.addEventListener('click',async ev=>{
    ev.stopPropagation();
    await openBook(e.dataset.openHighlight);
    await goToPhysicalPage(Number(e.dataset.page||0));
  }));
  document.querySelectorAll('.highlight-row').forEach(e=>e.addEventListener('click',async()=>{
    await openBook(e.dataset.open);
    await goToPhysicalPage(Number(e.dataset.page||0));
  }));
}
function renderUpload(){$('#content').innerHTML=`<div class="section-head"><h2>Add Books</h2></div><div class="upload-zone" id="drop"><h2>Turn your PDF into a book</h2><p>Alok Reader extracts text from text-based PDFs and creates a reflowable reading version. The original PDF is kept as a fallback.</p><button id="choose" class="btn primary">Choose PDF files</button></div>`;$('#choose').onclick=openFilePicker;const d=$('#drop');['dragenter','dragover'].forEach(e=>d.addEventListener(e,x=>{x.preventDefault();d.classList.add('drag')}));['dragleave','drop'].forEach(e=>d.addEventListener(e,x=>{x.preventDefault();d.classList.remove('drag')}));d.addEventListener('drop',e=>handleFiles(e.dataTransfer.files))}
function openFilePicker(){
  const input=$('#fileInput');
  if(input){
    input.value='';
    input.click();
  }
}
function render(){const names={library:'Home',collections:'Collections',bookmarks:'Bookmarks',highlights:'Highlights',upload:'Add Books'};$('#topTitle').textContent=names[screen]||'Home';document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.screen===screen));({library:renderLibrary,collections:renderCollections,bookmarks:renderBookmarks,highlights:renderHighlights,upload:renderUpload}[screen]||renderLibrary)()}
async function extractPdf(fileOrBuffer){
  const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
  const source=fileOrBuffer instanceof ArrayBuffer?new Uint8Array(fileOrBuffer.slice(0)):new Uint8Array(await fileOrBuffer.arrayBuffer());
  const doc=await pdfjs.getDocument({data:source}).promise; let text='';
  for(let pageNo=1;pageNo<=doc.numPages;pageNo++){
    const page=await doc.getPage(pageNo); const content=await page.getTextContent({includeMarkedContent:false});
    const items=content.items.filter(x=>x.str&&x.str.trim()); const rows=[];
    for(const item of items){
      const tr=item.transform||[1,0,0,1,0,0], x=tr[4]||0, y=tr[5]||0, h=Math.abs(tr[3]||item.height||10)||10;
      let row=rows.find(r=>Math.abs(r.y-y)<=Math.max(2,h*.35)); if(!row){row={y,h,items:[]};rows.push(row)}
      row.items.push({x,y,h,w:item.width||0,str:item.str});
    }
    rows.sort((a,b)=>b.y-a.y); const lines=[];
    for(const row of rows){
      row.items.sort((a,b)=>a.x-b.x); let line='',previous=null;
      for(const item of row.items){
        const piece=item.str.replace(/\s+/g,' ').trim(); if(!piece)continue;
        if(previous){const gap=item.x-(previous.x+previous.w),last=line.slice(-1),first=piece[0];
          if(gap>1.2&&!/[\s([{"'“‘—–-]$/.test(last)&&!/^[,.;:!?%)\]}'"”’—–-]/.test(first))line+=' ';}
        line+=piece; previous=item;
      }
      line=line.replace(/\s+([,.;:!?%)\]}])/g,'$1').trim(); if(line)lines.push({text:line,y:row.y,h:row.h});
    }
    let pageText='';
    for(let i=0;i<lines.length;i++){pageText+=lines[i].text;if(lines[i+1]){const gap=Math.abs(lines[i].y-lines[i+1].y),normal=Math.max(lines[i].h,lines[i+1].h);pageText+=gap>normal*1.75?'\n\n':'\n';}}
    text+=pageText.trim()+'\n\n';
  }
  return {text:text.trim(),pages:doc.numPages};
}
async function handleFiles(list){
  const files=[...list].filter(f=>f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf'));
  if(!files.length)return;
  const choose=document.querySelector('#choose');
  if(choose){choose.disabled=true;choose.textContent='Processing…';}
  for(const f of files){
    try{
      const extracted=await extractPdf(f);
      const t=f.name.replace(/\.pdf$/i,'');
      await put({id:uid(),name:f.name,title:t,author:'',size:f.size,data:await f.arrayBuffer(),text:extracted.text,totalPages:extracted.pages,lastPage:1,progress:0,bookmarks:[],highlights:[],created:Date.now(),extractionVersion:'2.6',paginationVersion:'2.11'});
    }catch(e){
      console.error('Book import failed',f.name,e);
      alert(`Could not process ${f.name}: ${e.message}`);
    }
  }
  books=await all();screen='library';render();
}
async function reprocessBook(book){const extracted=await extractPdf(book.data);book.text=extracted.text;book.totalPages=extracted.pages;book.extractionVersion='2.6';book.paginationVersion='2.11';await put(book);return book;}
async function openBook(id){
 current=books.find(b=>b.id===id);if(!current)return;
 if(current.reprocessRequired&&current.data){try{current=await reprocessBook(current);current.reprocessRequired=false;await put(current);books=books.map(b=>b.id===current.id?current:b)}catch(e){console.error(e)}}
 $('#readerBookTitle').textContent=titleOf(current);
 rawReadingHtml=`<div class="book-front"><div class="chapter-kicker">Reading</div><h1>${escapeHtml(titleOf(current))}</h1><div class="reading-author">${escapeHtml(current.author||'Personal book')}</div></div>${paragraphsFromText(current.text||'')}`;
 $('#reader').className='reader '+(current.theme||'light');$('#reader').classList.remove('hidden');$('#readerContents')?.classList.add('hidden');$('#readerBookmarks')?.classList.add('hidden');loadBookmarks();loadHighlights();readerPhysicalPage=0;updateSettingsUI();restorePosition();renderChapterList();renderReaderBookmarks();
}

let readerPages=[];
let readerPhysicalPage=0;
let readerChapters=[];
let readerBookmarks=[];
let readerHighlights=[];
let activeSelection=null;
function isEffectiveSpread(){
  return current?.layout==='spread' && window.innerWidth>700;
}


function pageMetrics(){
  const shell=$('.reading-shell');
  const spread=isEffectiveSpread();
  const width=Math.max(320,spread?Math.floor(shell.clientWidth/2):shell.clientWidth);
  const height=Math.max(300,shell.clientHeight-18);
  const padX=spread?38:52;
  const padY=34;
  return {width,height,padX,padY,contentWidth:Math.min(current.textWidth||760,width-padX*2),contentHeight:height-padY*2};
}

function createMeasure(){
  const m=document.createElement('div');
  const x=pageMetrics();
  m.className='book-page measure-page';
  Object.assign(m.style,{
    position:'fixed',left:'-100000px',top:'0',visibility:'hidden',
    pointerEvents:'none',boxSizing:'border-box',overflow:'hidden',
    width:x.width+'px',height:x.height+'px',
    padding:x.padY+'px '+x.padX+'px',
    fontSize:(current.fontSize||19)+'px',
    lineHeight:String(current.lineHeight||1.6),
    fontFamily:current.font==='sans'?'Inter,Arial,sans-serif':
      current.font==='book'?'"Palatino Linotype",Palatino,Georgia,serif':
      'Georgia,"Times New Roman",serif'
  });
  document.body.appendChild(m);
  return m;
}

function measureHtml(measure,html){
  measure.innerHTML=html;
  return measure.scrollHeight <= measure.clientHeight+1;
}

function splitParagraph(node,measure,initialHtml){
  const words=node.textContent.split(/\s+/).filter(Boolean);
  const chunks=[];
  let i=0;
  let prefix=initialHtml||'';

  while(i<words.length){
    let lo=1,hi=words.length-i,best=0;
    while(lo<=hi){
      const mid=(lo+hi)>>1;
      const candidate=prefix+`<p>${escapeHtml(words.slice(i,i+mid).join(' '))}</p>`;
      if(measureHtml(measure,candidate)){
        best=mid;lo=mid+1;
      }else{
        hi=mid-1;
      }
    }
    if(best===0)best=1;
    chunks.push(prefix+`<p>${escapeHtml(words.slice(i,i+best).join(' '))}</p>`);
    i+=best;
    prefix='';
  }
  return chunks;
}

function buildReaderPages(){
  if(!current)return;
  const source=document.createElement('div');
  source.innerHTML=rawReadingHtml||'';
  const nodes=[...source.children].filter(n=>n.textContent.trim());
  const measure=createMeasure();

  readerPages=[];
  readerChapters=[];
  let pageHtml='';

  const commit=()=>{
    if(pageHtml.trim())readerPages.push(pageHtml);
    pageHtml='';
  };

  for(const node of nodes){
    const html=node.outerHTML;
    const isChapter=node.tagName==='H2';

    // Keep a chapter heading with the content that follows whenever possible.
    if(isChapter && pageHtml.trim()){
      const withHeading=pageHtml+html;
      if(!measureHtml(measure,withHeading)){
        commit();
      }
    }

    if(isChapter){
      const title=node.textContent.trim();
      const pageNo=readerPages.length;
      // Avoid duplicate headings caused by repeated PDF text.
      if(!readerChapters.some(c=>c.title.toLowerCase()===title.toLowerCase())){
        readerChapters.push({title,page:pageNo});
      }
    }

    if(measureHtml(measure,pageHtml+html)){
      pageHtml+=html;
      continue;
    }

    if(pageHtml.trim())commit();

    if(node.tagName==='P'){
      const chunks=splitParagraph(node,measure,'');
      chunks.forEach((chunk,i)=>{
        pageHtml=chunk;
        if(i<chunks.length-1)commit();
      });
    }else{
      pageHtml=html;
      commit();
    }
  }

  commit();
  measure.remove();

  if(!readerPages.length){
    readerPages=['<p>No readable text was extracted from this book.</p>'];
  }

  readerPhysicalPage=Math.max(0,Math.min(readerPages.length-1,readerPhysicalPage));

  // Recalculate chapter pages after final pagination. A heading is on the page
  // where its rendered HTML occurs.
  readerChapters=readerChapters.map(ch=>{
    const needle=escapeHtml(ch.title);
    let page=readerPages.findIndex(p=>p.includes(needle));
    return {...ch,page:page<0?ch.page:page};
  });
}



function loadHighlights(){
  try{readerHighlights=Array.isArray(current?.highlights)?current.highlights:[]}
  catch(e){readerHighlights=[]}
}

function textNodesIn(root){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{
    acceptNode:n=>n.nodeValue?.trim()?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT
  });
  const out=[];let n;
  while(n=walker.nextNode())out.push(n);
  return out;
}

function wrapTextRange(root,startOffset,endOffset,className='reader-highlight'){
  const nodes=textNodesIn(root);
  let pos=0, first=null,last=null, firstLocal=0,lastLocal=0;
  for(const n of nodes){
    const end=pos+n.nodeValue.length;
    if(first===null && startOffset>=pos && startOffset<=end){
      first=n;firstLocal=Math.max(0,startOffset-pos);
    }
    if(endOffset>=pos && endOffset<=end){
      last=n;lastLocal=Math.max(0,endOffset-pos);break;
    }
    pos=end;
  }
  if(!first||!last)return false;

  const range=document.createRange();
  range.setStart(first,firstLocal);
  range.setEnd(last,lastLocal);

  // Avoid nesting marks when a previously applied highlight overlaps.
  const fragment=range.extractContents();
  const mark=document.createElement('mark');
  mark.className=className;
  mark.appendChild(fragment);
  range.insertNode(mark);
  return true;
}

function applyHighlightToPage(page,highlight){
  const section=page.querySelector('.book-page');
  if(!section||!highlight?.text)return false;

  const target=highlight.text.trim().replace(/\s+/g,' ');
  if(!target)return false;

  const nodes=textNodesIn(section);
  let combined='',starts=[];
  for(const n of nodes){
    starts.push(combined.length);
    combined+=n.nodeValue.replace(/\s+/g,' ');
  }
  const normalized=combined;
  const at=normalized.indexOf(target);
  if(at<0)return false;

  // Map normalized character positions back to raw text-node positions.
  let rawStart=0,rawEnd=0,seen=0;
  let startFound=false,endFound=false;
  for(const n of nodes){
    const raw=n.nodeValue;
    const norm=raw.replace(/\s+/g,' ');
    const normStart=seen,normEnd=seen+norm.length;
    if(!startFound && at>=normStart && at<=normEnd){
      rawStart=rawStart + Math.max(0,at-normStart);
      startFound=true;
    }
    const targetEnd=at+target.length;
    if(targetEnd>=normStart && targetEnd<=normEnd){
      rawEnd=rawStart + Math.max(0,targetEnd-normStart);
      endFound=true;break;
    }
    rawStart+=raw.length;
    seen=normEnd;
  }

  // More robust mapping using a character-by-character traversal.
  if(!startFound||!endFound){
    const map=[];
    let npos=0;
    for(const n of nodes){
      for(let i=0;i<n.nodeValue.length;i++)map.push([n,i]);
      npos+=n.nodeValue.length;
    }
    const rawCombined=nodes.map(n=>n.nodeValue).join('');
    const rawAt=rawCombined.indexOf(highlight.text.trim());
    if(rawAt<0)return false;
    const rawEndAt=rawAt+highlight.text.trim().length;
    return wrapAcrossNodes(section,nodes,rawAt,rawEndAt);
  }

  return wrapAcrossNodes(section,nodes,rawStart,rawEnd);
}

function wrapAcrossNodes(root,nodes,start,end){
  let pos=0,first=null,last=null,fo=0,lo=0;
  for(const n of nodes){
    const nEnd=pos+n.nodeValue.length;
    if(!first && start>=pos && start<=nEnd){first=n;fo=start-pos}
    if(end>=pos && end<=nEnd){last=n;lo=end-pos;break}
    pos=nEnd;
  }
  if(!first||!last||start===end)return false;
  const range=document.createRange();
  range.setStart(first,fo);range.setEnd(last,lo);
  const mark=document.createElement('mark');
  mark.className='reader-highlight';
  try{
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    return true;
  }catch(e){return false}
}

function applyStoredHighlights(){
  if(!current||!readerHighlights.length)return;

  const sections=[...document.querySelectorAll('#readingText .book-page')];
  if(!sections.length)return;

  // Remove old marks before reapplying. Reader pages are frequently rebuilt
  // after pagination/layout/font changes.
  removeHighlightMarks();

  for(const h of readerHighlights){
    const page=Number(h.page);
    const section=sections[page];

    if(!section) continue;

    let applied=false;

    // Prefer stored offsets because they survive repeated rendering better.
    if(typeof h.startOffset==='number' && typeof h.endOffset==='number'){
      applied=applyHighlightByOffset(section,h);
    }

    // Fallback for old highlights created before offsets were stored.
    if(!applied){
      applied=applyHighlightToPage(section,h);
    }

    console.log('Highlight restore', {
      page,
      text:h.text?.slice(0,50),
      applied
    });
  }
}

function removeHighlightMarks(){
  document.querySelectorAll('#readingText mark.reader-highlight').forEach(m=>{
    const p=m.parentNode;
    while(m.firstChild)p.insertBefore(m.firstChild,m);
    p.removeChild(m);
    p.normalize();
  });
}


function getSelectionOffset(range,root){
  if(!range||!root)return 0;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let pos=0,n;
  while(n=walker.nextNode()){
    if(n===range.startContainer)return pos+range.startOffset;
    pos+=n.nodeValue.length;
  }
  return 0;
}

function getSelectionEndOffset(range,root){
  if(!range||!root)return 0;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let pos=0,n;
  while(n=walker.nextNode()){
    if(n===range.endContainer)return pos+range.endOffset;
    pos+=n.nodeValue.length;
  }
  return pos;
}

function applyHighlightByOffset(root,h){
  if(typeof h.startOffset!=='number'||typeof h.endOffset!=='number') return false;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let nodes=[],n,total=0;
  while(n=walker.nextNode()){
    nodes.push({n,start:total,end:total+n.nodeValue.length});
    total+=n.nodeValue.length;
  }
  let startNode,endNode,startLocal,endLocal;
  for(const x of nodes){
    if(startNode===undefined && h.startOffset>=x.start && h.startOffset<=x.end){
      startNode=x.n; startLocal=h.startOffset-x.start;
    }
    if(h.endOffset>=x.start && h.endOffset<=x.end){
      endNode=x.n; endLocal=h.endOffset-x.start; break;
    }
  }
  if(!startNode||!endNode)return false;
  try{
    const range=document.createRange();
    range.setStart(startNode,startLocal);
    range.setEnd(endNode,endLocal);
    const mark=document.createElement('mark');
    mark.className='reader-highlight';
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
    return true;
  }catch(e){return false}
}

async function saveHighlight(text,note=''){
  if(!current||!text?.trim())return;
  loadHighlights();
  const normalized=text.trim().replace(/\s+/g,' ');
  const duplicate=readerHighlights.find(h=>Number(h.page)===readerPhysicalPage && h.text===normalized);
  if(duplicate){
    if(note)duplicate.note=note;
  }else{
    readerHighlights.push({
      id:uid(),
      page:current.layout==='spread'
        ? Math.floor(readerPhysicalPage/2)*2
        : readerPhysicalPage,
      text:normalized,
      note:note||'',
      startOffset: getSelectionOffset(activeSelection?.range, $('#readingText')),
      endOffset: getSelectionEndOffset(activeSelection?.range, $('#readingText')),
      createdAt:new Date().toISOString()
    });
  }
  current.highlights=readerHighlights;
  await put(current);
  applyStoredHighlights();
  renderHighlights();
}

function selectedText(){
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||!sel.rangeCount)return null;
  const range=sel.getRangeAt(0);
  const reader=$('#readingText');
  if(!reader||!reader.contains(range.commonAncestorContainer))return null;
  const text=sel.toString().trim().replace(/\s+/g,' ');
  return text?{sel,range,text}:null;
}

function closeSelectionMenu(){
  $('#selectionMenu')?.classList.add('hidden');
  activeSelection=null;
}

function openSelectionMenu(){
  const picked=selectedText();
  const menu=$('#selectionMenu');
  if(!picked||!menu)return;
  activeSelection=picked;
  const rect=picked.range.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(window.innerWidth-210,rect.left+rect.width/2-100))+'px';
  menu.style.top=Math.max(72,rect.top-52)+'px';
  menu.classList.remove('hidden');
}

async function createHighlightFromSelection(){
  if(!activeSelection)return;
  const text=activeSelection.text;
  const page=readerPhysicalPage;
  closeSelectionMenu();
  window.getSelection()?.removeAllRanges();
  await saveHighlight(text,'');
}

async function createNoteFromSelection(){
  if(!activeSelection)return;
  const text=activeSelection.text;
  closeSelectionMenu();
  const note=window.prompt('Add a note for this highlight:','');
  window.getSelection()?.removeAllRanges();
  if(note!==null)await saveHighlight(text,note.trim());
}

function setupSelectionTools(){
  const reader=$('#readingText');
  if(!reader)return;
  reader.addEventListener('mouseup',()=>setTimeout(openSelectionMenu,0));
  reader.addEventListener('touchend',()=>setTimeout(openSelectionMenu,80),{passive:true});
}

function loadBookmarks(){
  try{
    readerBookmarks=Array.isArray(current?.bookmarks)?current.bookmarks:[];
  }catch(e){readerBookmarks=[]}
}
function isBookmarked(page=readerPhysicalPage){
  return readerBookmarks.some(b=>Number(b.page)===Number(page));
}
function updateBookmarkButton(){
  const b=$('#readerBookmarkBtn');
  if(!b)return;
  const active=isBookmarked();
  b.classList.toggle('active',active);
  b.textContent=active?'★':'☆';
  b.title=active?'Remove bookmark':'Bookmark this page';
}
async function toggleBookmark(){
  if(!current)return;
  loadBookmarks();
  const page=readerPhysicalPage;
  const idx=readerBookmarks.findIndex(b=>Number(b.page)===Number(page));
  if(idx>=0){
    readerBookmarks.splice(idx,1);
  }else{
    readerBookmarks.push({
      page,
      createdAt:new Date().toISOString(),
      label:current.layout==='spread'
        ? `Pages ${page+1}–${Math.min(readerPages.length,page+2)}`
        : `Page ${page+1}`
    });
    readerBookmarks.sort((x,y)=>x.page-y.page);
  }
  current.bookmarks=readerBookmarks;
  await put(current);
  updateBookmarkButton();
  renderReaderBookmarks();
}
function renderReaderBookmarks(){
  const panel=$('#readerBookmarks');
  if(!panel)return;
  loadBookmarks();
  if(!readerBookmarks.length){
    panel.innerHTML='<div class="contents-empty">No bookmarks yet. Click ☆ while reading to bookmark this page.</div>';
    return;
  }
  panel.innerHTML=`
    <div class="contents-title">Bookmarks</div>
    <div class="contents-book">${escapeHtml(titleOf(current))}</div>
    <div class="contents-list">
      ${readerBookmarks.map((b,i)=>`
        <button class="contents-item" data-bookmark="${i}">
          <span>${escapeHtml(b.label||`Page ${Number(b.page)+1}`)}</span>
          <small>→</small>
        </button>`).join('')}
    </div>`;
  panel.querySelectorAll('[data-bookmark]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const b=readerBookmarks[Number(btn.dataset.bookmark)];
      if(!b)return;
      await goToPhysicalPage(Number(b.page));
      panel.classList.add('hidden');
    });
  });
}
function toggleBookmarks(){
  const panel=$('#readerBookmarks');
  if(!panel)return;
  if(panel.classList.contains('hidden')){
    renderReaderBookmarks();
    panel.classList.remove('hidden');
  }else{
    panel.classList.add('hidden');
  }
}

function renderChapterList(){
  const panel=$('#readerContents');
  if(!panel)return;
  if(!readerChapters.length){
    panel.innerHTML='<div class="contents-empty">No chapter headings were detected in this book.</div>';
    return;
  }
  panel.innerHTML=`
    <div class="contents-title">Contents</div>
    <div class="contents-book">${escapeHtml(titleOf(current))}</div>
    <div class="contents-list">
      ${readerChapters.map((c,i)=>`
        <button class="contents-item" data-chapter="${i}">
          <span>${escapeHtml(c.title)}</span>
          <small>${c.page+1}</small>
        </button>`).join('')}
    </div>`;
  panel.querySelectorAll('[data-chapter]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const ch=readerChapters[Number(btn.dataset.chapter)];
      if(!ch)return;
      await goToPhysicalPage(ch.page);
      panel.classList.add('hidden');
    });
  });
}

function toggleContents(){
  const panel=$('#readerContents');
  if(!panel)return;
  if(panel.classList.contains('hidden')){
    renderChapterList();
    panel.classList.remove('hidden');
  }else{
    panel.classList.add('hidden');
  }
}

async function goToPhysicalPage(physical,save=true){
  const target=Math.max(0,Math.min(readerPages.length-1,physical));
  readerPhysicalPage=current.layout==='spread'
    ? Math.floor(target/2)*2
    : target;
  renderReaderPage();
  if(save)await saveProgress();
}

function renderReaderPage(){
  const text=$('#readingText');
  if(!text||!current)return;

  const spread=isEffectiveSpread();
  const shell=$('.reading-shell');
  if(shell) shell.classList.toggle('spread-reading',spread);
  const first=spread
    ? Math.min(readerPages.length-1,Math.floor(readerPhysicalPage/2)*2)
    : readerPhysicalPage;

  let html=`<section class="book-page">${readerPages[first]||''}</section>`;
  if(spread && readerPages[first+1]){
    html+=`<section class="book-page">${readerPages[first+1]}</section>`;
  }

  text.className='reading-text '+(current.font||'serif')+(spread?' spread-mode':'');
  text.innerHTML=html;
  text.style.fontSize=(current.fontSize||19)+'px';
  text.style.lineHeight=current.lineHeight||1.6;

  updatePageLabel();
  updateBookmarkButton();

  // Wait until browser paints the final reader DOM before adding marks.
  requestAnimationFrame(()=>{
    requestAnimationFrame(applyStoredHighlights);
  });
}

function getUnitCount(){
  return current.layout==='spread'
    ? Math.max(1,Math.ceil(readerPages.length/2))
    : Math.max(1,readerPages.length);
}

function getUnitIndex(){
  return current.layout==='spread'
    ? Math.floor(readerPhysicalPage/2)
    : readerPhysicalPage;
}

function updatePageLabel(){
  const units=getUnitCount();
  const idx=Math.min(units-1,Math.max(0,getUnitIndex()));
  const pct=units<=1?0:Math.round(idx/(units-1)*100);
  const progress=$('#readerProgress');
  if(progress)progress.value=pct;

  const label=$('#readerProgressLabel');
  if(label){
    const totalWords=(rawReadingHtml||'').replace(/<[^>]+>/g,' ').trim().split(/\s+/).filter(Boolean).length;
    const wordsPerMinute=220;
    const remaining=Math.max(0,Math.round(totalWords*(1-(pct/100))/wordsPerMinute));
    const timeText=remaining>=60?`${Math.floor(remaining/60)}h ${remaining%60}m`: `${remaining}m`;
    if(isEffectiveSpread()){
      const first=idx*2+1;
      const last=Math.min(readerPages.length,first+1);
      label.textContent=`Pages ${first}–${last} / ${readerPages.length} · ${pct}% · ${timeText} left`;
    }else{
      label.textContent=`Page ${idx+1} / ${readerPages.length} · ${pct}% · ${timeText} left`;
    }
  }
}

async function goToPage(unitIndex,save=true){
  const units=getUnitCount();
  const target=Math.max(0,Math.min(units-1,unitIndex));
  const physical=isEffectiveSpread() ? target*2 : target;
  await goToPhysicalPage(physical,save);
}

function repaginate(){
  if(!current)return;
  const oldPhysical=readerPhysicalPage;
  buildReaderPages();
  readerPhysicalPage=Math.min(oldPhysical,readerPages.length-1);
  renderReaderPage();
  renderChapterList();
}

function restorePosition(){
  buildReaderPages();

  const savedPhysical=current.readerPage!=null
    ? Number(current.readerPage)
    : Math.round((current.progress||0)*Math.max(0,readerPages.length-1));

  readerPhysicalPage=Math.max(0,Math.min(readerPages.length-1,savedPhysical));
  renderReaderPage();
}

async function saveProgress(){
  if(!current||!readerPages.length)return;
  current.readerPage=readerPhysicalPage;
  current.progress=readerPages.length<=1?0:
    readerPhysicalPage/Math.max(1,readerPages.length-1);
  await put(current);
}
function updateSettingsUI(){
  $('#fontSizeValue').textContent=(current.fontSize||19)+'px';
  document.querySelectorAll('#fontChoices button').forEach(b=>b.classList.toggle('active',b.dataset.font===(current.font||'serif')));
  document.querySelectorAll('#themeChoices button').forEach(b=>b.classList.toggle('active',b.dataset.theme===(current.theme||'light')));
  document.querySelectorAll('#lineChoices button').forEach(b=>b.classList.toggle('active',String(b.dataset.line)===String(current.lineHeight||1.6)));
  document.querySelectorAll('#layoutChoices button').forEach(b=>b.addEventListener('click',async()=>{
  if(!current)return;
  const physical=readerPhysicalPage;
  current.layout=b.dataset.layout;
  buildReaderPages();
  readerPhysicalPage=Math.max(0,Math.min(readerPages.length-1,
    current.layout==='spread'?Math.floor(physical/2)*2:physical));
  updateSettingsUI();
  renderReaderPage();
  await put(current);
}));
  document.querySelectorAll('#widthChoices button').forEach(b=>b.classList.toggle('active',String(b.dataset.width)===String(current.textWidth||760)));
}
function applySettings(){
  const r=$('#reader'),text=$('#readingText');
  r.className='reader '+(current.theme||'light');
  text.style.fontSize=(current.fontSize||19)+'px';
  text.style.lineHeight=current.lineHeight||1.6;
  text.className='reading-text '+(current.font||'serif');
  $('#fontSizeValue').textContent=(current.fontSize||19)+'px';
  document.querySelectorAll('#fontChoices button').forEach(b=>b.classList.toggle('active',b.dataset.font===(current.font||'serif')));
  document.querySelectorAll('#themeChoices button').forEach(b=>b.classList.toggle('active',b.dataset.theme===(current.theme||'light')));
  document.querySelectorAll('#lineChoices button').forEach(b=>b.classList.toggle('active',String(b.dataset.line)===String(current.lineHeight||1.6)));
  document.querySelectorAll('#layoutChoices button').forEach(b=>b.classList.toggle('active',b.dataset.layout===(current.layout||'single')));
  document.querySelectorAll('#widthChoices button').forEach(b=>b.classList.toggle('active',String(b.dataset.width)===String(current.textWidth||760)));
  repaginate();
}
$('#readerClose').onclick=async()=>{$('#reader').classList.add('hidden');books=await all();render()};$('#pdfClose').onclick=()=>{$('#pdfViewer').classList.add('hidden');$('#pdfFrame').src=''};$('#readerOriginal').onclick=()=>{const blob=new Blob([current.data],{type:'application/pdf'});$('#pdfFrame').src=URL.createObjectURL(blob);$('#pdfViewer').classList.remove('hidden')};$('#readerSearchBtn').onclick=()=>{$('#readerSearch').classList.toggle('hidden');$('#readerSearchInput').focus()};$('#readerContentsBtn')?.addEventListener('click',toggleContents);
$('#readerBookmarkBtn')?.addEventListener('click',toggleBookmark);
$('#selectionHighlight')?.addEventListener('mousedown',e=>e.preventDefault());
$('#selectionNote')?.addEventListener('mousedown',e=>e.preventDefault());
$('#selectionHighlight')?.addEventListener('click',createHighlightFromSelection);
$('#selectionNote')?.addEventListener('click',createNoteFromSelection);
$('#selectionMenu')?.addEventListener('mousedown',e=>e.stopPropagation());
document.addEventListener('mousedown',e=>{if(!$('#selectionMenu')?.contains(e.target))closeSelectionMenu()});

$('#readerBookmarksBtn')?.addEventListener('click',toggleBookmarks);

$('#readerSearchInput').oninput=e=>{const q=e.target.value.trim();if(!q){rawReadingHtml=`<div class="book-front"><div class="chapter-kicker">Reading</div><h1>${escapeHtml(titleOf(current))}</h1><div class="reading-author">${escapeHtml(current.author||'Personal book')}</div></div>${paragraphsFromText(current.text||'')}`;repaginate();$('#readerSearchCount').textContent='';return}const temp=document.createElement('div');temp.innerHTML=paragraphsFromText(current.text||'');const escaped=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),re=new RegExp(escaped,'ig');let n=0;temp.querySelectorAll('p,h2,h3').forEach(el=>{const plain=el.textContent;n+=(plain.match(re)||[]).length;el.innerHTML=escapeHtml(plain).replace(re,m=>`<mark class="search-hit">${m}</mark>`)});rawReadingHtml=temp.innerHTML;repaginate();$('#readerSearchCount').textContent=n?`${n} matches`:'No matches'};
$('#readerProgress')?.addEventListener('input',e=>{
  const units=getUnitCount();
  goToPage(Math.round((+e.target.value/100)*Math.max(0,units-1)));
});
document.addEventListener('keydown',e=>{
  if($('#reader')?.classList.contains('hidden'))return;
  if(e.key==='ArrowRight'||e.key==='PageDown'){e.preventDefault();goToPage(getUnitIndex()+1)}
  if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();goToPage(getUnitIndex()-1)}
});
$('#prevReaderPage')?.addEventListener('click',()=>goToPage(getUnitIndex()-1));
let lastReaderNarrowState=window.innerWidth<=700;
window.addEventListener('resize',()=>{
  if($('#reader')?.classList.contains('hidden')||!current)return;
  const nowNarrow=window.innerWidth<=700;
  if(nowNarrow!==lastReaderNarrowState){
    lastReaderNarrowState=nowNarrow;
    renderReaderPage();
    updatePageLabel();
  }
});
$('#nextReaderPage')?.addEventListener('click',()=>goToPage(getUnitIndex()+1));
$('#settingsBtn')?.addEventListener('click',()=>$('#readingSettings')?.classList.toggle('hidden'));$('#readerAa')?.addEventListener('click',()=>$('#readingSettings')?.classList.toggle('hidden'));$('#closeSettings')?.addEventListener('click',()=>$('#readingSettings')?.classList.add('hidden'));
$('#fontDown')?.addEventListener('click',()=>{current.fontSize=Math.max(14,(current.fontSize||19)-1);updateSettingsUI();repaginate();put(current)});
$('#fontUp')?.addEventListener('click',()=>{current.fontSize=Math.min(30,(current.fontSize||19)+1);updateSettingsUI();repaginate();put(current)});
document.querySelectorAll('#fontChoices button').forEach(b=>b.addEventListener('click',()=>{current.font=b.dataset.font;updateSettingsUI();repaginate();put(current)}));
document.querySelectorAll('#themeChoices button').forEach(b=>b.addEventListener('click',()=>{current.theme=b.dataset.theme;applySettings();put(current)}));
document.querySelectorAll('#lineChoices button').forEach(b=>b.addEventListener('click',()=>{current.lineHeight=+b.dataset.line;updateSettingsUI();repaginate();put(current)}));

document.querySelectorAll('#widthChoices button').forEach(b=>b.addEventListener('click',()=>{current.textWidth=+b.dataset.width;updateSettingsUI();repaginate();put(current)}));
$('#globalSearch').oninput=e=>{query=e.target.value;screen='library';render()};
document.querySelectorAll('.nav-item[data-screen]').forEach(nav=>{
  nav.addEventListener('click',e=>{
    e.preventDefault();
    screen=nav.dataset.screen||'library';
    $('#sidebar').classList.remove('open');
    render();
  });
});
$('#menuBtn').onclick=()=>$('#sidebar').classList.toggle('open');
window.handleFiles=handleFiles;
$('#fileInput')?.addEventListener('change',e=>handleFiles(e.target.files));
document.addEventListener('keydown',e=>{if($('#reader').classList.contains('hidden'))return;if(e.key==='Escape')$('#readerClose').click();if(e.key==='f')$('#readerSearchBtn').click();if(e.key==='t')toggleContents();if(e.key==='b')toggleBookmark()});
setupSelectionTools();await openDB();books=await all();render();
