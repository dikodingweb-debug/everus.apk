(() => {
  let token = sessionStorage.getItem("td_session_token");
  let state = { user:null, combinedBalance:0, savingPrice:0, canManagePrice:false, transactions:[], pending:[], notifications:[], pendingPayment:null, selected:null, barcodeUrl:"", barcodeEnabled:true, barcodeAvailableToday:true };
  let pollTimer = null;
  const $ = id => document.getElementById(id);
  const rupiah = n => new Intl.NumberFormat("id-ID", {style:"currency", currency:"IDR", maximumFractionDigits:0}).format(Number(n||0));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const dateText = v => v ? new Date(v).toLocaleString("id-ID", {dateStyle:"medium", timeStyle:"short"}) : "—";
  const toast = msg => { const el=$("toast"); el.textContent=msg; el.classList.add("show"); clearTimeout(window.__toast); window.__toast=setTimeout(()=>el.classList.remove("show"),2800); };
  const openModal = id => { const el=$(id); if(!el)return; el.classList.add("open"); el.setAttribute("aria-hidden","false"); };
  const closeModal = id => { const el=$(id); if(!el)return; el.classList.remove("open"); el.setAttribute("aria-hidden","true"); if(id==="amountModal")stopSelfieCamera(); };
  const setLoading = on => document.body.classList.toggle("data-loading", !!on);

  // Ketersediaan barcode sepenuhnya mengikuti pengaturan admin dari server.
  let selfieStream=null,selfieDataUrl="";
  function barcodeIsEnabled(value) {
    return value === true || value === 1 || ["true", "1", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
  }

  function openQris() {
    const available=state.barcodeEnabled || state.barcodeAvailableToday;
    const notice=$("qrisAvailabilityNotice"), frame=document.querySelector(".qris-frame"), info=document.querySelector(".payment-info");
    if(notice){
      notice.hidden=available;
      notice.textContent="Barcode hanya dapat digunakan setiap hari Rabu. Tombol menabung tetap tersedia; silakan kembali pada hari Rabu berikutnya.";
    }
    if(frame) frame.hidden=!available;
    if(info) info.hidden=!available;
    $("paidBtn").hidden=!available;
    openModal("qrisModal");
  }

  async function boot(){
    if(!token) return location.href="login.html";
    bindEvents();
    try {
      // Gunakan data bootstrap dari login bila tersedia agar dashboard tidak langsung membuat request kedua.
      const bootstrapRaw=sessionStorage.getItem("td_dashboard_bootstrap");
      if(bootstrapRaw){
        sessionStorage.removeItem("td_dashboard_bootstrap");
        applyDashboardData(JSON.parse(bootstrapRaw));
        render();
      } else {
        await refresh(false);
      }
      if(state.pendingPayment) openQris();
      startPolling();
    } catch(err){ toast(err.message); if(/token|session|login/i.test(err.message)) logout(); }
  }

  function bindEvents(){
    $("logoutBtn").onclick=logout;
    $("accountBtn").onclick=()=>{closeMobileNav();openModal("accountModal");};
    $("priceBtn").onclick=()=>{closeMobileNav();$("priceInput").value=state.savingPrice||"";openModal("priceModal");};
    $("refreshBtn").onclick=()=>refresh(true);
    $("saveBtn").onclick=openQris;
    $("paidBtn").onclick=()=>{closeModal("qrisModal");renderAutoAmount();openModal("amountModal");};
    $("amountForm").onsubmit=submitAmount;
    $("startCameraBtn").onclick=startSelfieCamera;
    $("captureSelfieBtn").onclick=captureSelfie;
    $("retakeSelfieBtn").onclick=()=>{selfieDataUrl="";startSelfieCamera();};
    $("priceForm").onsubmit=submitPrice;
    $("notificationBtn").onclick=toggleNotifications;
    $("closeNotifications").onclick=()=>$("notificationPanel").classList.remove("open");
    $("deleteAllNotifications").onclick=deleteAllNotifications;
    $("mobileMenuBtn").onclick=toggleMobileNav;
    $("mobileNavClose").onclick=closeMobileNav;
    $("mobileNavBackdrop").onclick=closeMobileNav;
    document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
    $("approveBtn").onclick=()=>processApproval("approve");
    $("rejectBtn").onclick=()=>processApproval("reject");
    $("accountForm").onsubmit=submitAccountChanges;
    const today=new Date();
    const currentMonth=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
    ["transactionMonth","pendingMonth"].forEach(id=>$(id).value=currentMonth);
    $("transactionMonth").onchange=()=>updateDateBounds("transactionMonth","transactionDate");
    $("pendingMonth").onchange=()=>updateDateBounds("pendingMonth","pendingDate");
    ["transactionDate","pendingDate"].forEach(id=>$(id).onchange=renderActivityLists);
    updateDateBounds("transactionMonth","transactionDate");
    updateDateBounds("pendingMonth","pendingDate");
  }

  function applyDashboardData(data){
    state.user=data.user; state.combinedBalance=Number(data.combinedBalance||0); state.savingPrice=Number(data.savingPrice||0);
    state.canManagePrice=!!data.canManagePrice; state.transactions=data.transactions||[]; state.pending=data.pending||[]; state.notifications=data.notifications||[];
    state.pendingPayment=data.pendingPayment||null; state.barcodeUrl=data.barcodeUrl||""; state.barcodeEnabled=barcodeIsEnabled(data.barcodeEnabled); state.barcodeAvailableToday=!!data.barcodeAvailableToday;
  }

  async function refresh(showToast=false){
    setLoading(true);
    try{
      const data=await API.getDashboard(token);
      applyDashboardData(data);
      render(); if(showToast)toast("Data diperbarui.");
    } finally { setLoading(false); }
  }

  function startPolling(){
    clearInterval(pollTimer);
    pollTimer=setInterval(async()=>{ if(document.hidden)return; try{await refresh(false);}catch(_){} }, window.APP_CONFIG?.POLL_MS||120000);
  }

  function render(){
    $("greeting").textContent=`Halo, ${state.user.display_name}`;
    $("combinedBalanceValue").textContent=rupiah(state.combinedBalance);
    $("balanceValue").textContent=rupiah(state.user.balance);
    $("balanceUpdated").textContent=`Terakhir diperbarui ${new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}`;
    $("pendingCount").textContent=state.pending.length;
    $("saveBtn").disabled=false;
    const qrisImg=document.querySelector(".qris-frame img"); if(qrisImg){if(state.barcodeUrl){qrisImg.src=state.barcodeUrl;qrisImg.hidden=false;$("qrisPlaceholder").hidden=true;}else{qrisImg.hidden=true;qrisImg.removeAttribute("src");$("qrisPlaceholder").hidden=false;}}
    $("savingPriceLabel").textContent=state.savingPrice>0?`Harga menabung: ${rupiah(state.savingPrice)}`:"Harga menabung belum diatur";
    $("priceBtn").hidden=!state.canManagePrice;
    $("notificationBadge").hidden=state.notifications.filter(n=>!n.is_read).length===0;
    $("notificationBadge").textContent=state.notifications.filter(n=>!n.is_read).length;
    renderAutoAmount(); renderActivityLists(); renderNotifications(); try{window.PriceChart&&window.PriceChart.update(state.transactions,state.savingPrice);}catch(_){}
  }

  function renderAutoAmount(){ $("autoAmountValue").textContent=state.savingPrice>0?rupiah(state.savingPrice):"Harga belum diatur"; }

  function updateDateBounds(monthId,dateId){
    const month=$(monthId).value;
    const date=$(dateId);
    date.min=month?`${month}-01`:"";
    const lastDay=month?new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate():0;
    date.max=month?`${month}-${String(lastDay).padStart(2,"0")}`:"";
    if(date.value && month && !date.value.startsWith(`${month}-`))date.value="";
    renderActivityLists();
  }

  function matchesActivityDate(value,month,date){
    if(!value)return false;
    const parsed=new Date(value);
    if(Number.isNaN(parsed.getTime()))return false;
    const monthKey=`${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,"0")}`;
    const dateKey=`${monthKey}-${String(parsed.getDate()).padStart(2,"0")}`;
    return (!month || monthKey===month) && (!date || dateKey===date);
  }

  function renderActivityLists(){ renderTransactions(); renderPending(); }

  function renderTransactions(){
    const el=$("transactionList");
    if(!state.transactions.length)return el.innerHTML='<div class="empty-state">Belum ada transaksi.</div>';
    const month=$("transactionMonth").value, date=$("transactionDate").value;
    const filtered=state.transactions.filter(t=>matchesActivityDate(t.created_at,month,date));
    if(!filtered.length)return el.innerHTML='<div class="empty-state">Tidak ada transaksi pada periode ini.</div>';
    el.innerHTML=filtered.map(t=>`<article class="transaction-row"><div><div class="transaction-title">Menabung · ${esc(t.sender_name)}</div><div class="transaction-meta">${esc(t.transaction_id)} · ${dateText(t.created_at)}</div><span class="status status-${String(t.status).toLowerCase()}">${esc(t.status)}</span></div><div class="amount">${rupiah(t.amount)}</div></article>`).join("");
  }

  function renderPending(){
    const el=$("pendingList"); if(!state.pending.length)return el.innerHTML='<div class="empty-state">Tidak ada transaksi pending.</div>';
    const month=$("pendingMonth").value, date=$("pendingDate").value;
    const filtered=state.pending.filter(t=>matchesActivityDate(t.created_at,month,date));
    if(!filtered.length)return el.innerHTML='<div class="empty-state">Tidak ada approval pada periode ini.</div>';
    el.innerHTML=filtered.map(t=>`<article class="pending-item" data-id="${esc(t.transaction_id)}"><strong>${esc(t.sender_name)} → Anda</strong><span class="amount">${rupiah(t.amount)}</span><div class="transaction-meta">${dateText(t.created_at)}</div></article>`).join("");
    el.querySelectorAll(".pending-item").forEach(x=>x.onclick=()=>showApproval(x.dataset.id));
  }

  function renderNotifications(){
    const el=$("notificationList");
    if(!state.notifications.length)return el.innerHTML='<div class="empty-state">Belum ada notifikasi.</div>';
    el.innerHTML=state.notifications.map(n=>`<article class="notification-item ${n.is_read?"":"unread"}" data-notif="${esc(n.notification_id)}"><div class="notification-content"><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><time>${dateText(n.created_at)}</time></div><button class="notification-delete" type="button" title="Hapus" aria-label="Hapus notifikasi" data-delete-notif="${esc(n.notification_id)}">×</button></article>`).join("");
    el.querySelectorAll("[data-delete-notif]").forEach(btn=>btn.onclick=async e=>{e.stopPropagation();await deleteNotification(btn.dataset.deleteNotif);});
    el.querySelectorAll(".notification-item").forEach(item=>item.onclick=async()=>{
      const id=item.dataset.notif; const target=state.notifications.find(n=>n.notification_id===id);
      if(target && !target.is_read){ target.is_read=true; render(); try{await API.markNotificationRead(token,id);}catch(e){toast(e.message);await refresh(false);} }
    });
  }

  function toggleNotifications(){ $("notificationPanel").classList.toggle("open"); }

  async function deleteNotification(id){
    try{await API.deleteNotification(token,id);state.notifications=state.notifications.filter(n=>n.notification_id!==id);render();toast("Notifikasi dihapus.");}
    catch(e){toast(e.message);}
  }
  async function deleteAllNotifications(){
    if(!state.notifications.length)return toast("Tidak ada notifikasi untuk dihapus.");
    if(!confirm("Hapus semua notifikasi Anda?"))return;
    try{await API.deleteAllNotifications(token);state.notifications=[];render();toast("Semua notifikasi dihapus.");}
    catch(e){toast(e.message);}
  }

  function showApproval(id){
    state.selected=state.pending.find(t=>t.transaction_id===id); if(!state.selected)return;
    const t=state.selected;
    $("approvalDetails").innerHTML=`<div class="detail-line"><span>ID transaksi</span><strong>${esc(t.transaction_id)}</strong></div><div class="detail-line"><span>Pengirim</span><strong>${esc(t.sender_name)}</strong></div><div class="detail-line"><span>Nominal</span><strong>${rupiah(t.amount)}</strong></div><div class="detail-line"><span>Waktu</span><strong>${dateText(t.created_at)}</strong></div><div class="detail-line"><span>Status</span><strong>${esc(t.status)}</strong></div>`;
    openModal("approvalModal");
  }

  async function processApproval(kind){
    if(!state.selected)return; const id=state.selected.transaction_id; const button=kind==="approve"?$("approveBtn"):$("rejectBtn"); button.disabled=true;
    try{ if(kind==="approve"){await API.approveTransaction(token,id);toast("Transaksi berhasil di-approve.");}else{const reason=prompt("Alasan penolakan (opsional):")||"Ditolak oleh approver.";await API.rejectTransaction(token,id,reason);toast("Transaksi ditolak.");} closeModal("approvalModal");state.selected=null;await refresh(false); }
    catch(e){toast(e.message);} finally{button.disabled=false;}
  }

  async function submitPrice(event){
    event.preventDefault(); const amount=Number($("priceInput").value.replace(/\D/g,"")); if(!Number.isSafeInteger(amount)||amount<=0)return toast("Harga harus lebih dari Rp0.");
    const button=event.submitter;button.disabled=true;
    try{const result=await API.setSavingPrice(token,amount);state.savingPrice=Number(result.savingPrice);closeModal("priceModal");render();toast(result.message||"Harga diperbarui.");}
    catch(e){toast(e.message);} finally{button.disabled=false;}
  }

  async function submitAccountChanges(event){
    event.preventDefault(); const newUsername=$("newUsernameInput").value.trim().toLowerCase(),newPassword=$("newPasswordInput").value,confirmPassword=$("confirmPasswordInput").value,currentPassword=$("currentPasswordInput").value;
    if(!newUsername&&!newPassword)return toast("Isi username baru atau password baru.");
    if(newPassword!==confirmPassword)return toast("Konfirmasi password baru tidak cocok.");
    if(newPassword&&newPassword.length<8)return toast("Password baru minimal 8 karakter.");
    if(newUsername&&!/^[a-z0-9._-]{3,30}$/.test(newUsername))return toast("Username 3-30 karakter dan hanya boleh huruf kecil, angka, titik, garis bawah, atau strip.");
    const button=event.submitter;button.disabled=true;
    try{const result=await API.updateCredentials(token,currentPassword,newUsername,newPassword);state.user=result.user;["newUsernameInput","newPasswordInput","confirmPasswordInput","currentPasswordInput"].forEach(id=>$(id).value="");closeModal("accountModal");render();toast(result.message||"Data akun berhasil diperbarui.");}
    catch(e){toast(e.message);} finally{button.disabled=false;}
  }

  async function startSelfieCamera(){
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error("Kamera tidak tersedia. Buka web melalui HTTPS atau browser yang mendukung kamera.");
      stopSelfieCamera();
      selfieStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:720},height:{ideal:720}},audio:false});
      const video=$("selfieVideo");video.srcObject=selfieStream;video.hidden=false;$("selfiePreview").hidden=true;$("cameraPlaceholder").hidden=true;
      $("captureSelfieBtn").disabled=false;$("retakeSelfieBtn").hidden=true;selfieDataUrl="";
    }catch(e){toast(e.message||"Tidak dapat mengakses kamera. Periksa izin kamera.");}
  }
  function captureSelfie(){
    const video=$("selfieVideo"),canvas=$("selfieCanvas");if(!selfieStream||!video.videoWidth)return toast("Tunggu sampai kamera siap.");
    const side=Math.min(video.videoWidth,video.videoHeight),sx=(video.videoWidth-side)/2,sy=(video.videoHeight-side)/2;
    canvas.width=720;canvas.height=720;canvas.getContext("2d").drawImage(video,sx,sy,side,side,0,0,720,720);
    selfieDataUrl=canvas.toDataURL("image/jpeg",.88);$("selfiePreview").src=selfieDataUrl;$("selfiePreview").hidden=false;video.hidden=true;
    $("captureSelfieBtn").disabled=true;$("retakeSelfieBtn").hidden=false;stopSelfieCamera();
  }
  function stopSelfieCamera(){if(selfieStream){selfieStream.getTracks().forEach(t=>t.stop());selfieStream=null;}$("captureSelfieBtn").disabled=true;}
  async function submitAmount(event){
    event.preventDefault(); if(!state.savingPrice)return toast("User A belum mengatur harga menabung.");
    if(!selfieDataUrl)return toast("Ambil foto selfie terlebih dahulu sebelum mengirim konfirmasi.");
    const button=event.submitter;button.disabled=true;
    try{const result=await API.createTransaction(token,selfieDataUrl);
      selfieDataUrl="";$("selfiePreview").hidden=true;$("selfiePreview").removeAttribute("src");$("cameraPlaceholder").hidden=false;$("cameraPlaceholder").textContent="Kamera belum diaktifkan";$("retakeSelfieBtn").hidden=true;
      closeModal("amountModal");state.pendingPayment=null;toast(result.message||"Konfirmasi dikirim.");await refresh(false);}
    catch(e){toast(e.message);} finally{button.disabled=false;}
  }

  function toggleMobileNav(){document.body.classList.toggle("mobile-nav-open");}
  function closeMobileNav(){document.body.classList.remove("mobile-nav-open");}
  function logout(){
    const adminToken=sessionStorage.getItem("td_admin_token");
    if(adminToken){sessionStorage.setItem("td_session_token",adminToken);sessionStorage.removeItem("td_admin_token");sessionStorage.removeItem("td_impersonating_user");location.href="admin.html";return;}
    sessionStorage.removeItem("td_session_token");clearInterval(pollTimer);location.href="login.html";
  }

  document.addEventListener("visibilitychange",async()=>{ if(!document.hidden && token){ /* Tidak refresh otomatis saat kembali ke tab; polling tetap 120 detik. */ } });
  boot();
})();
