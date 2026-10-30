(() => {
 const token=sessionStorage.getItem("td_session_token"),$=id=>document.getElementById(id);
 let cropData="",loadedImage=null,cropScale=1,cropX=0,cropY=0,dragPoint=null,objectUrl="";
 const msg=(s,bad=false)=>{ $("status").textContent=s;$("status").style.color=bad?"#b42318":""; };
 const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 async function run(fn){try{return await fn()}catch(e){msg(e.message||"Terjadi kesalahan.",true);throw e}}
 let adminData=null;
 async function load(){if(!token)return location.href="login.html";const d=await API.adminGetData(token);adminData=d;
 $("barcodeEnabled").checked=d.barcodeEnabled;const currentPreview=$("currentBarcodePreview");if(d.barcodeUrl){currentPreview.src=d.barcodeUrl;currentPreview.hidden=false;}else{currentPreview.hidden=true;currentPreview.removeAttribute("src");}
 $("usersTable").innerHTML=table(["ID","Username","Nama","Saldo","Status","Akses"],d.users.map(u=>[u.user_id,u.username,u.display_name,"Rp "+Number(u.balance).toLocaleString("id-ID"),u.status,["A001","B001"].includes(u.user_id)?`<button class="btn btn-ghost" data-access-user="${u.user_id}">Buka halaman</button>`:"—"]));
 $("usersTable").querySelectorAll("[data-access-user]").forEach(b=>b.onclick=async()=>{const r=await API.adminImpersonate(token,b.dataset.accessUser);sessionStorage.setItem("td_admin_token",token);sessionStorage.setItem("td_session_token",r.token);sessionStorage.setItem("td_impersonating_user",b.dataset.accessUser);location.href="dashboard.html";});
 $("schedulesTable").innerHTML=table(["ID","Penerima","Judul","Waktu","Ulang","Aktif"],d.schedules.map(s=>[s.schedule_id,s.target_user_id,s.title,s.run_at,s.repeat,s.active]));
 $("userCount").textContent=d.users.length;$("proofCount").textContent=d.proofs.length;$("barcodeStatus").textContent=d.barcodeEnabled?"Aktif setiap hari":"Khusus hari Rabu";
 renderProofFilters(d.proofs);renderProofs();msg("Data admin berhasil dimuat.");}
 function table(head,rows){if(!rows.length)return '<p class="muted">Belum ada data.</p>';return '<table class="admin-table"><thead><tr>'+head.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+(String(x).startsWith('<button class=')?String(x):esc(x||'—'))+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}

 function proofDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?null:d;}
 function proofDriveId(url){const m=String(url||"").match(/(?:\/d\/|[?&]id=)([-\w]{20,})/);return m?m[1]:"";}
 function proofMonthKey(value){const d=proofDate(value);return d?d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"):"unknown";}
 function renderProofFilters(proofs){const select=$("proofMonth"),current=select.value;const keys=[...new Set(proofs.map(p=>proofMonthKey(p.created_at)).filter(k=>k!=="unknown"))].sort().reverse();select.innerHTML='<option value="all">Semua bulan</option>'+keys.map(k=>{const [y,m]=k.split("-");return `<option value="${k}">${new Date(Number(y),Number(m)-1,1).toLocaleDateString("id-ID",{month:"long",year:"numeric"})}</option>`}).join("");if(keys.includes(current))select.value=current;}
 function renderProofs(){const proofs=adminData?.proofs||[],month=$("proofMonth").value,query=$("proofSearch").value.trim().toLowerCase();const filtered=proofs.filter(p=>(month==="all"||proofMonthKey(p.created_at)===month)&&(!query||[p.user_id,p.transaction_id,p.proof_id].some(v=>String(v||"").toLowerCase().includes(query))));$("proofSummary").textContent=`Menampilkan ${filtered.length} dari ${proofs.length} bukti foto.`;const host=$("proofsTable");if(!filtered.length){host.innerHTML='<p class="muted">Tidak ada bukti foto pada periode atau pencarian ini.</p>';return;}
 host.innerHTML=filtered.map(p=>{const id=proofDriveId(p.file_url),thumb=id?`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w600`:p.file_url;const date=proofDate(p.created_at);const dateText=date?date.toLocaleString("id-ID"):"Tanggal tidak tersedia";return `<article class="proof-card"><img class="proof-thumb" src="${esc(thumb)}" alt="Bukti foto ${esc(p.proof_id)}" data-preview-proof="${esc(p.proof_id)}" loading="lazy"><div class="proof-meta"><strong>${esc(p.proof_id)}</strong><span>Pengguna: ${esc(p.user_id)}</span><span>Transaksi: ${esc(p.transaction_id)}</span><span>${esc(dateText)}</span></div><div class="proof-actions"><button class="btn btn-ghost" data-preview-proof="${esc(p.proof_id)}">Lihat foto</button><button class="btn btn-ghost" data-delete-proof="${esc(p.proof_id)}">Hapus</button></div></article>`}).join("");
 host.querySelectorAll("[data-preview-proof]").forEach(el=>el.onclick=()=>{const p=filtered.find(x=>String(x.proof_id)===el.dataset.previewProof);if(!p)return;const id=proofDriveId(p.file_url);$("proofModalTitle").textContent=`${p.proof_id} · ${p.user_id}`;$("proofModalImage").src=id?`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w1600`:p.file_url;$("proofOpenDrive").href=p.file_url;$("proofModal").classList.add("open");});
 host.querySelectorAll("[data-delete-proof]").forEach(b=>b.onclick=async()=>{if(!confirm("Hapus foto ini dari daftar dan Google Drive? Tindakan ini tidak dapat dibatalkan."))return;b.disabled=true;try{const r=await API.adminDeleteFaceProof(token,b.dataset.deleteProof);msg(r.message||"Bukti foto dihapus.");await load();}catch(e){b.disabled=false;msg(e.message||"Foto gagal dihapus.",true);}});
 }
 document.querySelectorAll("[data-view-target]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-view-target]").forEach(x=>x.classList.toggle("active",x===b));document.querySelectorAll("[data-view]").forEach(v=>v.classList.toggle("active",v.dataset.view===b.dataset.viewTarget));const titles={overview:"Ringkasan",accounts:"Akun pengguna",barcode:"Pengaturan barcode",notifications:"Notifikasi",proofs:"Bukti foto"};$("pageTitle").textContent=titles[b.dataset.viewTarget]||"Panel Admin";});
 $("proofMonth").onchange=renderProofs;$("proofSearch").oninput=renderProofs;
 $("closeProofModal").onclick=()=>$("proofModal").classList.remove("open");$("proofModal").onclick=e=>{if(e.target===$("proofModal"))$("proofModal").classList.remove("open");};
 $("logout").onclick=()=>{sessionStorage.removeItem("td_session_token");sessionStorage.removeItem("td_dashboard_bootstrap");location.href="login.html"};
 $("userForm").onsubmit=async e=>{e.preventDefault();await run(async()=>{const r=await API.adminUpdateUser(token,$("userId").value,$("username").value,$("password").value);$("username").value="";$("password").value="";msg(r.message);await load()})};
 $("sendForm").onsubmit=async e=>{e.preventDefault();await run(async()=>{const r=await API.adminSendNotification(token,$("sendTarget").value,$("sendTitle").value,$("sendMessage").value);msg(r.message);$("sendForm").reset()})};
 $("scheduleForm").onsubmit=async e=>{e.preventDefault();await run(async()=>{const r=await API.adminScheduleNotification(token,$("scheduleTarget").value,$("scheduleTitle").value,$("scheduleMessage").value,new Date($("runAt").value).toISOString(),$("repeat").value);msg(r.message);$("scheduleForm").reset();await load()})};
 function drawCrop(){
  const c=$("cropCanvas"),ctx=c.getContext("2d");ctx.clearRect(0,0,600,600);ctx.fillStyle="#f4f8f6";ctx.fillRect(0,0,600,600);
  if(!loadedImage){ctx.fillStyle="#718078";ctx.font="24px sans-serif";ctx.textAlign="center";ctx.fillText("Pratinjau barcode",300,305);cropData="";return;}
  const base=Math.max(600/loadedImage.width,600/loadedImage.height),scale=base*cropScale,w=loadedImage.width*scale,h=loadedImage.height*scale;
  cropX=Math.min(0,Math.max(600-w,cropX));cropY=Math.min(0,Math.max(600-h,cropY));
  ctx.drawImage(loadedImage,cropX,cropY,w,h);
  // Simpan hasil crop persegi persis seperti yang terlihat di kanvas.
  cropData=c.toDataURL("image/jpeg",.78);
 }
 $("barcodeFile").onchange=e=>{const f=e.target.files[0];if(!f)return;if(f.size>3*1024*1024){msg("Ukuran gambar maksimum 3 MB.",true);e.target.value="";return}if(!/^image\/(png|jpeg|webp)$/.test(f.type)){msg("Pilih gambar PNG, JPG, atau WEBP.",true);return}if(objectUrl)URL.revokeObjectURL(objectUrl);const img=new Image();img.onload=()=>{loadedImage=img;cropScale=1;$("cropZoom").value="1";const base=Math.max(600/img.width,600/img.height);cropX=(600-img.width*base)/2;cropY=(600-img.height*base)/2;drawCrop();};objectUrl=URL.createObjectURL(f);img.src=objectUrl;};
 $("cropZoom").oninput=e=>{if(!loadedImage)return;const old=cropScale;cropScale=Number(e.target.value);const factor=cropScale/old;cropX=300-(300-cropX)*factor;cropY=300-(300-cropY)*factor;drawCrop();};
 const cropCanvas=$("cropCanvas");
 cropCanvas.onpointerdown=e=>{if(!loadedImage)return;dragPoint={x:e.clientX,y:e.clientY};cropCanvas.setPointerCapture(e.pointerId);};
 cropCanvas.onpointermove=e=>{if(!dragPoint)return;const rect=cropCanvas.getBoundingClientRect(),sx=600/rect.width,sy=600/rect.height;cropX+=(e.clientX-dragPoint.x)*sx;cropY+=(e.clientY-dragPoint.y)*sy;dragPoint={x:e.clientX,y:e.clientY};drawCrop();};
 cropCanvas.onpointerup=cropCanvas.onpointercancel=()=>{dragPoint=null;};
 $("saveBarcode").onclick=()=>run(async()=>{const requestedEnabled=$("barcodeEnabled").checked;$("saveBarcode").disabled=true;try{const r=await API.adminSetBarcode(token,requestedEnabled,cropData);if(Boolean(r.barcodeEnabled)!==requestedEnabled)throw new Error("Status akses barcode dari server tidak sesuai. Periksa kembali Sheet Settings.");cropData="";loadedImage=null;$("barcodeFile").value="";$("cropZoom").value="1";drawCrop();await load();msg(r.message+" Mode: "+(requestedEnabled?"setiap hari":"khusus hari Rabu")+".");}finally{$("saveBarcode").disabled=false;}});
 drawCrop();
 load().catch(()=>{});
})();