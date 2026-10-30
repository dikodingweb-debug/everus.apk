/**
 * TABUNGAN DIGITAL — Google Apps Script backend
 *
 * 1) Buat spreadsheet.
 * 2) Buat sheet: Users, Transactions, Sessions, Notifications.
 * 3) Extensions > Apps Script, tempel file ini.
 * 4) Isi SPREADSHEET_ID di Script Properties atau langsung di konstanta.
 *
 * Prototype ini memakai session token server-side. Untuk production:
 * - gunakan secret/session yang lebih kuat dan rotasi token,
 * - jangan menyimpan password plaintext,
 * - pertimbangkan database transaksional/payment gateway,
 * - tambahkan rate limiting dan audit log.
 */

const SHEETS = {
  USERS: "Users",
  TRANSACTIONS: "Transactions",
  SESSIONS: "Sessions",
  NOTIFICATIONS: "Notifications",
  SETTINGS: "Settings",
  SCHEDULES: "NotificationSchedules",
  FACE_PROOFS: "FaceProofs"
};

const HEADERS = {
  Users: ["user_id","username","display_name","password_hash","balance","created_at","status"],
  Transactions: ["transaction_id","sender_id","sender_name","receiver_id","receiver_name","approver_id","amount","type","status","created_at","approved_at","rejected_at","rejection_reason"],
  Sessions: ["token","user_id","created_at","expires_at"],
  Notifications: ["notification_id","user_id","transaction_id","title","message","is_read","created_at"],
  Settings: ["key","value","updated_by","updated_at"],
  NotificationSchedules: ["schedule_id","target_user_id","title","message","run_at","repeat","active","last_sent"],
  FaceProofs: ["proof_id","user_id","transaction_id","file_url","created_at","status"]
};

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    const result = route_(payload);
    return json_(result);
  } catch (err) {
    return json_({ ok:false, message: safeMessage_(err) });
  }
}

function doGet(e) {
  return json_({ ok:true, service:"Tabungan Digital API", message:"Gunakan POST untuk API." });
}

function route_(p) {
  switch (p.action) {
    case "login": return login_(p);
    case "getDashboard": return getDashboard_(p);
    case "getPendingPayment": return getPendingPayment_(p);
    case "createTransaction": return createTransaction_(p);
    case "approveTransaction": return approveTransaction_(p);
    case "rejectTransaction": return rejectTransaction_(p);
    case "markNotificationRead": return markNotificationRead_(p);
    case "deleteNotification": return deleteNotification_(p);
    case "deleteAllNotifications": return deleteAllNotifications_(p);
    case "setSavingPrice": return setSavingPrice_(p);
    case "updateCredentials": return updateCredentials_(p);
    case "adminGetData": return adminGetData_(p);
    case "adminImpersonate": return adminImpersonate_(p);
    case "adminUpdateUser": return adminUpdateUser_(p);
    case "adminSendNotification": return adminSendNotification_(p);
    case "adminScheduleNotification": return adminScheduleNotification_(p);
    case "adminSetBarcode": return adminSetBarcode_(p);
    case "uploadFaceProof": return uploadFaceProof_(p);
    case "adminDeleteFaceProof": return adminDeleteFaceProof_(p);
    default: throw new Error("Action tidak dikenal.");
  }
}

function setupSheets() {
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
  Object.keys(HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS[name]);
  });
}

function login_(p) {
  const username = String(p.username || "").trim().toLowerCase();
  const password = String(p.password || "");
  if (!username || !password) throw new Error("Username dan password wajib diisi.");

  // Login hanya membaca Users sekali (dengan cache pendek) lalu membuat session.
  // Dashboard TIDAK dimuat di sini agar respons login tetap ringan.
  const users = activeUsers_();
  const user = users.find(u => String(u.username).toLowerCase() === username);
  if (!user) throw new Error("Username atau password salah.");

  if (sha256_(password) !== String(user.password_hash || "")) {
    throw new Error("Username atau password salah.");
  }

  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, "");
  const now = new Date();
  const expires = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  append_("Sessions", [token, user.user_id, now, expires]);

  // Session cache menghindari pembacaan sheet Sessions + Users pada request berikutnya.
  cacheSession_(token, user, expires);
  return { ok:true, token, user:publicUser_(user) };
}

function getDashboard_(p) {
  const user = requireSession_(p.token);
  const tx = recentRows_("Transactions", 60).filter(t => String(t.sender_id) === String(user.user_id) || String(t.receiver_id) === String(user.user_id));
  const pending = tx.filter(t => String(t.status) === "PENDING" && String(t.approver_id) === String(user.user_id));
  const notifications = recentRows_("Notifications", 30)
    .filter(n => String(n.user_id) === String(user.user_id))
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 20);

  const users = activeUsers_();
  const combinedBalance = users.reduce((sum, u) => sum + (Number(u.balance) || 0), 0);

  // Pending payment digabungkan ke response dashboard agar pembukaan dashboard hanya butuh 1 request.
  const rawPayment = PropertiesService.getScriptProperties().getProperty("PAYMENT_" + user.user_id);
  const pendingPayment = rawPayment ? JSON.parse(rawPayment) : null;

  return {
    ok:true,
    user:publicUser_(user),
    combinedBalance,
    savingPrice:getSavingPrice_(),
    canManagePrice:String(user.user_id) === "A001",
    transactions:serializeRows_(tx).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,20),
    pending:serializeRows_(pending),
    notifications:serializeRows_(notifications),
    pendingPayment,
    barcodeUrl:getSetting_("BARCODE_URL") || "",
    barcodeEnabled:barcodeEnabled_(),
    barcodeAvailableToday:barcodeAvailableToday_()
  };
}

function getPendingPayment_(p) {
  const user = requireSession_(p.token);
  // "QRIS belum dikonfirmasi" direpresentasikan sebagai draft server-side:
  // transaksi PENDING_PAYMENT belum masuk Transactions sampai nominal dikirim.
  const props = PropertiesService.getScriptProperties();
  const key = "PAYMENT_" + user.user_id;
  const raw = props.getProperty(key);
  return { ok:true, pendingPayment: raw ? JSON.parse(raw) : null };
}

function createTransaction_(p) {
  const user = requireSession_(p.token);
  if (!barcodeEnabled_() && !barcodeAvailableToday_()) throw new Error("Barcode hanya dapat digunakan setiap hari Rabu. Silakan kembali pada hari Rabu berikutnya.");
  const selfieData=String(p.selfieDataUrl||"");
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(selfieData) || selfieData.length>5000000) throw new Error("Bukti selfie wajib diambil melalui kamera sebelum konfirmasi.");
  // Nominal selalu diambil dari server agar frontend tidak dapat memanipulasinya.
  const amount = Number(getSavingPrice_());
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000) throw new Error("Harga menabung belum diatur oleh User A.");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const other = findOtherUser_(user.user_id);
    if (!other) throw new Error("Approver belum tersedia.");

    const txId = "TRX-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    const now = new Date();
    // Simpan bukti selfie dalam alur yang sama agar transaksi tidak tercatat tanpa bukti.
    saveFaceProof_(user,txId,selfieData);
    append_("Transactions", [
      txId, user.user_id, user.display_name, other.user_id, other.display_name,
      other.user_id, amount, "SAVING", "PENDING", now, "", "", ""
    ]);

    append_("Notifications", [
      "NTF-" + Utilities.getUuid().slice(0,8).toUpperCase(),
      other.user_id, txId, "Approval diperlukan",
      user.display_name + " mengirim permintaan menabung sebesar " + formatRupiah_(amount) + ". Menunggu persetujuan Anda.",
      false, now
    ]);

    PropertiesService.getScriptProperties().deleteProperty("PAYMENT_" + user.user_id);
    return { ok:true, transactionId:txId, message:"Pembayaran berhasil dikirim dan sedang menunggu persetujuan " + other.display_name + "." };
  } finally {
    lock.releaseLock();
  }
}

function approveTransaction_(p) {
  const user = requireSession_(p.token);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(getSpreadsheetId_());
    const sh = ss.getSheetByName(SHEETS.TRANSACTIONS);
    const values = sh.getDataRange().getValues();
    const headers = values.shift();
    const idx = headerMap_(headers);
    const rowIndex = values.findIndex(r => String(r[idx.transaction_id]) === String(p.transactionId));
    if (rowIndex < 0) throw new Error("Transaksi tidak ditemukan.");

    const row = values[rowIndex];
    if (String(row[idx.status]) !== "PENDING") throw new Error("Transaksi sudah diproses.");
    if (String(row[idx.approver_id]) !== String(user.user_id)) throw new Error("Anda bukan approver transaksi ini.");

    const amount = Number(row[idx.amount]);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Nominal transaksi tidak valid.");

    const users = ss.getSheetByName(SHEETS.USERS);
    const uValues = users.getDataRange().getValues();
    const uh = uValues.shift();
    const ui = headerMap_(uh);
    const senderRow = uValues.findIndex(r => String(r[ui.user_id]) === String(row[idx.sender_id]));
    if (senderRow < 0) throw new Error("User pengirim tidak ditemukan.");

    const currentBalance = Number(uValues[senderRow][ui.balance]) || 0;
    users.getRange(senderRow + 2, ui.balance + 1).setValue(currentBalance + amount);
    invalidateUserCache_();

    sh.getRange(rowIndex + 2, idx.status + 1).setValue("APPROVED");
    sh.getRange(rowIndex + 2, idx.approved_at + 1).setValue(new Date());

    append_("Notifications", [
      "NTF-" + Utilities.getUuid().slice(0,8).toUpperCase(),
      row[idx.sender_id], row[idx.transaction_id], "Transaksi disetujui",
      "Permintaan menabung sebesar " + formatRupiah_(amount) + " telah disetujui.",
      false, new Date()
    ]);
    return { ok:true, message:"Transaksi disetujui." };
  } finally {
    lock.releaseLock();
  }
}

function rejectTransaction_(p) {
  const user = requireSession_(p.token);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(getSpreadsheetId_());
    const sh = ss.getSheetByName(SHEETS.TRANSACTIONS);
    const values = sh.getDataRange().getValues();
    const headers = values.shift();
    const idx = headerMap_(headers);
    const rowIndex = values.findIndex(r => String(r[idx.transaction_id]) === String(p.transactionId));
    if (rowIndex < 0) throw new Error("Transaksi tidak ditemukan.");
    const row = values[rowIndex];

    if (String(row[idx.status]) !== "PENDING") throw new Error("Transaksi sudah diproses.");
    if (String(row[idx.approver_id]) !== String(user.user_id)) throw new Error("Anda bukan approver transaksi ini.");

    const reason = String(p.reason || "Ditolak oleh approver.").slice(0, 300);
    sh.getRange(rowIndex + 2, idx.status + 1).setValue("REJECTED");
    sh.getRange(rowIndex + 2, idx.rejected_at + 1).setValue(new Date());
    sh.getRange(rowIndex + 2, idx.rejection_reason + 1).setValue(reason);

    append_("Notifications", [
      "NTF-" + Utilities.getUuid().slice(0,8).toUpperCase(),
      row[idx.sender_id], row[idx.transaction_id], "Transaksi ditolak",
      "Permintaan menabung sebesar " + formatRupiah_(Number(row[idx.amount])) + " ditolak. " + reason,
      false, new Date()
    ]);
    return { ok:true, message:"Transaksi ditolak." };
  } finally {
    lock.releaseLock();
  }
}

function markNotificationRead_(p) {
  const user = requireSession_(p.token);
  const sh = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEETS.NOTIFICATIONS);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  const idx = headerMap_(headers);
  const rowIndex = values.findIndex(r => String(r[idx.notification_id]) === String(p.notificationId));
  if (rowIndex < 0) throw new Error("Notifikasi tidak ditemukan.");
  if (String(values[rowIndex][idx.user_id]) !== String(user.user_id)) throw new Error("Akses ditolak.");
  sh.getRange(rowIndex + 2, idx.is_read + 1).setValue(true);
  return { ok:true };
}

function deleteNotification_(p) {
  const user = requireSession_(p.token);
  const sh = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEETS.NOTIFICATIONS);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  const idx = headerMap_(headers);
  const rowIndex = values.findIndex(r => String(r[idx.notification_id]) === String(p.notificationId));
  if (rowIndex < 0) throw new Error("Notifikasi tidak ditemukan.");
  if (String(values[rowIndex][idx.user_id]) !== String(user.user_id)) throw new Error("Akses ditolak.");
  sh.deleteRow(rowIndex + 2);
  return { ok:true };
}

function deleteAllNotifications_(p) {
  const user = requireSession_(p.token);
  const sh = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEETS.NOTIFICATIONS);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return { ok:true, deleted:0 };
  const headers = values[0];
  const idx = headerMap_(headers);
  const rows = values.slice(1);
  let deleted = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][idx.user_id]) === String(user.user_id)) {
      sh.deleteRow(i + 2);
      deleted++;
    }
  }
  return { ok:true, deleted };
}

function setSavingPrice_(p) {
  const user = requireSession_(p.token);
  if (String(user.user_id) !== "A001") throw new Error("Hanya User A yang dapat mengatur harga menabung.");
  const amount = Number(p.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000000) throw new Error("Harga harus berupa nominal rupiah yang valid.");
  const sh = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEETS.SETTINGS);
  const values = sh.getDataRange().getValues();
  const headers = values.shift();
  const idx = headerMap_(headers);
  const rowIndex = values.findIndex(r => String(r[idx.key]) === "SAVING_PRICE");
  const now = new Date();
  if (rowIndex < 0) sh.appendRow(["SAVING_PRICE", amount, user.user_id, now]);
  else sh.getRange(rowIndex + 2, idx.value + 1, 1, 3).setValues([[amount, user.user_id, now]]);
  CacheService.getScriptCache().remove("SAVING_PRICE");
  return { ok:true, savingPrice:amount, message:"Harga menabung berhasil diperbarui." };
}

function getSavingPrice_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get("SAVING_PRICE");
  if (cached !== null) return Number(cached) || 0;

  const sh = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEETS.SETTINGS);
  if (!sh || sh.getLastRow() < 2) return 0;
  const lastCol = sh.getLastColumn();
  const values = sh.getRange(1, 1, sh.getLastRow(), lastCol).getValues();
  const headers = values.shift();
  const idx = headerMap_(headers);
  const row = values.find(r => String(r[idx.key]) === "SAVING_PRICE");
  const amount = row ? Number(row[idx.value]) || 0 : 0;
  cache.put("SAVING_PRICE", String(amount), 120);
  return amount;
}

function updateCredentials_(p) {
  const user = requireSession_(p.token);
  const currentPassword = String(p.currentPassword || "");
  const newUsername = String(p.newUsername || "").trim().toLowerCase();
  const newPassword = String(p.newPassword || "");

  if (!currentPassword) throw new Error("Password saat ini wajib diisi.");
  if (!newUsername && !newPassword) throw new Error("Isi username baru atau password baru.");
  if (newUsername && !/^[a-z0-9._-]{3,30}$/.test(newUsername)) {
    throw new Error("Username 3-30 karakter: huruf kecil, angka, titik, garis bawah, atau strip.");
  }
  if (newPassword && newPassword.length < 8) throw new Error("Password baru minimal 8 karakter.");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(getSpreadsheetId_());
    const sh = ss.getSheetByName(SHEETS.USERS);
    const values = sh.getDataRange().getValues();
    const headers = values.shift();
    const idx = headerMap_(headers);
    const rowIndex = values.findIndex(r => String(r[idx.user_id]) === String(user.user_id));
    if (rowIndex < 0) throw new Error("User tidak ditemukan.");

    const row = values[rowIndex];
    if (sha256_(currentPassword) !== String(row[idx.password_hash] || "")) {
      throw new Error("Password saat ini salah.");
    }

    if (newUsername && newUsername !== String(row[idx.username]).toLowerCase()) {
      const duplicate = values.some(r => String(r[idx.user_id]) !== String(user.user_id) && String(r[idx.username]).toLowerCase() === newUsername);
      if (duplicate) throw new Error("Username tersebut sudah digunakan.");
      sh.getRange(rowIndex + 2, idx.username + 1).setValue(newUsername);
    }

    if (newPassword) {
      sh.getRange(rowIndex + 2, idx.password_hash + 1).setValue(sha256_(newPassword));
    }

    invalidateUserCache_();
    const updatedUser = Object.assign({}, row);
    if (newUsername) updatedUser.username = newUsername;
    if (newPassword) updatedUser.password_hash = sha256_(newPassword);
    cacheSession_(p.token, updatedUser, new Date(Date.now() + 12 * 60 * 60 * 1000));
    return { ok:true, user:publicUser_(updatedUser), message:"Data akun berhasil diperbarui." };
  } finally {
    lock.releaseLock();
  }
}


function requireAdmin_(token) {
  const u = requireSession_(token);
  if (String(u.user_id) !== "ADMIN001") throw new Error("Akses khusus admin.");
  return u;
}

function adminImpersonate_(p) {
  requireAdmin_(p.token);
  const targetId=String(p.userId||"");
  if(!["A001","B001"].includes(targetId)) throw new Error("Hanya User A atau User B yang dapat diakses.");
  const user=activeUsers_().find(u=>String(u.user_id)===targetId);
  if(!user) throw new Error("Akun target tidak aktif.");
  const token=Utilities.getUuid()+Utilities.getUuid().replace(/-/g,"");
  const now=new Date(), expires=new Date(now.getTime()+60*60*1000);
  append_("Sessions",[token,user.user_id,now,expires]);
  cacheSession_(token,user,expires);
  return {ok:true,token,message:"Mode akses pengguna aktif selama 1 jam."};
}

function adminGetData_(p) {
  requireAdmin_(p.token);
  return {ok:true, users:rows_("Users").map(u=>({user_id:u.user_id,username:u.username,display_name:u.display_name,balance:Number(u.balance)||0,status:u.status})),
    notifications:recentRows_("Notifications",100), schedules:rows_("NotificationSchedules"), proofs:rows_("FaceProofs"),
    barcodeUrl:getSetting_("BARCODE_URL")||"", barcodeEnabled:barcodeEnabled_(), barcodeAvailableToday:barcodeAvailableToday_()};
}
function adminUpdateUser_(p) {
  const admin=requireAdmin_(p.token), id=String(p.userId||"");
  const username=String(p.username||"").trim().toLowerCase(), password=String(p.password||"");
  if (!["A001","B001","ADMIN001"].includes(id)) throw new Error("Akun tidak dikenal.");
  if (username && !/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error("Format username tidak valid.");
  if (password && password.length<8) throw new Error("Password minimal 8 karakter.");
  const sh=SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName("Users"), vals=sh.getDataRange().getValues(), idx=headerMap_(vals.shift());
  const ri=vals.findIndex(r=>String(r[idx.user_id])===id); if(ri<0) throw new Error("User tidak ditemukan.");
  if(username && vals.some((r,i)=>i!==ri && String(r[idx.username]).toLowerCase()===username)) throw new Error("Username sudah digunakan.");
  if(username) sh.getRange(ri+2,idx.username+1).setValue(username);
  if(password) sh.getRange(ri+2,idx.password_hash+1).setValue(sha256_(password));
  invalidateUserCache_();
  return {ok:true,message:"Akun berhasil diperbarui."};
}
function adminSendNotification_(p) {
  const admin=requireAdmin_(p.token), target=String(p.targetUserId||"ALL");
  const title=String(p.title||"").trim().slice(0,100), message=String(p.message||"").trim().slice(0,1000);
  if(!title||!message) throw new Error("Judul dan isi notifikasi wajib diisi.");
  const users=activeUsers_().filter(u=>target==="ALL"||String(u.user_id)===target);
  if(!users.length) throw new Error("Penerima tidak ditemukan.");
  const now=new Date();
  users.forEach(u=>append_("Notifications",["NTF-"+Utilities.getUuid().slice(0,8).toUpperCase(),u.user_id,"",title,message,false,now]));
  return {ok:true,message:"Notifikasi berhasil dikirim."};
}
function adminScheduleNotification_(p) {
  requireAdmin_(p.token);
  const target=String(p.targetUserId||"ALL"), title=String(p.title||"").trim().slice(0,100), message=String(p.message||"").trim().slice(0,1000);
  const runAt=new Date(p.runAt), repeat=String(p.repeat||"NONE");
  if(!title||!message||isNaN(runAt.getTime())) throw new Error("Lengkapi judul, isi, dan waktu jadwal.");
  if(!["NONE","DAILY","WEEKLY"].includes(repeat)) throw new Error("Pengulangan tidak valid.");
  append_("NotificationSchedules",["SCH-"+Utilities.getUuid().slice(0,8).toUpperCase(),target,title,message,runAt,repeat,true,""]);
  return {ok:true,message:"Jadwal notifikasi disimpan. Pastikan trigger processScheduledNotifications aktif."};
}
function processScheduledNotifications() {
  const sh=SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName("NotificationSchedules");
  if(!sh || sh.getLastRow()<2) return;
  const vals=sh.getDataRange().getValues(), idx=headerMap_(vals.shift()), now=new Date();
  vals.forEach((r,i)=>{
    if(String(r[idx.active])!=="true" && r[idx.active]!==true) return;
    const runAt=new Date(r[idx.run_at]); if(isNaN(runAt)||runAt>now) return;
    if(r[idx.last_sent] && String(r[idx.repeat])==="NONE") return;
    const users=activeUsers_().filter(u=>String(r[idx.target_user_id])==="ALL"||String(u.user_id)===String(r[idx.target_user_id]));
    users.forEach(u=>append_("Notifications",["NTF-"+Utilities.getUuid().slice(0,8).toUpperCase(),u.user_id,"",r[idx.title],r[idx.message],false,now]));
    if(String(r[idx.repeat])==="NONE"){sh.getRange(i+2,idx.active+1).setValue(false);}
    else {
      const next=new Date(runAt); if(String(r[idx.repeat])==="DAILY") next.setDate(next.getDate()+1); else next.setDate(next.getDate()+7);
      sh.getRange(i+2,idx.run_at+1).setValue(next); sh.getRange(i+2,idx.last_sent+1).setValue(now);
    }
  });
}
function adminSetBarcode_(p) {
  requireAdmin_(p.token);
  const enabled=String(p.enabled)==="true";
  let savedUrl=getSetting_("BARCODE_URL")||"";
  if(p.dataUrl) {
    const match=String(p.dataUrl).match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if(!match) throw new Error("Gambar barcode tidak valid. Pilih PNG, JPG, atau WEBP lalu coba kembali.");
    if(match[2].length>4500000) throw new Error("Ukuran hasil crop terlalu besar. Kurangi ukuran gambar lalu coba kembali.");
    let file=null;
    try {
      const bytes=Utilities.base64Decode(match[2]);
      const ext=match[1]==="jpeg"?"jpg":match[1];
      const blob=Utilities.newBlob(bytes,"image/"+(ext==="jpg"?"jpeg":ext),"everus-qris-"+Date.now()+"."+ext);
      const folderId=PropertiesService.getScriptProperties().getProperty("BARCODE_FOLDER_ID");
      if(folderId) {
        let folder;
        try { folder=DriveApp.getFolderById(folderId); folder.getName(); }
        catch(folderError) { throw new Error("BARCODE_FOLDER_ID tidak valid atau akun Apps Script tidak memiliki akses ke folder Drive."); }
        file=folder.createFile(blob);
      } else {
        file=DriveApp.createFile(blob);
      }
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW); }
      catch(shareError) { throw new Error("File barcode berhasil dibuat, tetapi izin berbagi Drive gagal. Periksa kebijakan berbagi Google Drive akun pemilik Apps Script."); }
      savedUrl="https://drive.google.com/thumbnail?id="+file.getId()+"&sz=w1200";
      setSetting_("BARCODE_URL",savedUrl,"ADMIN001");
    } catch(err) {
      throw new Error("Barcode belum tersimpan: "+(err && err.message ? err.message : String(err)));
    }
  }
  setSetting_("BARCODE_ENABLED",String(enabled),"ADMIN001");
  return {ok:true,barcodeUrl:savedUrl,barcodeEnabled:enabled,barcodeAvailableToday:enabled||barcodeAvailableToday_(),message:p.dataUrl?"Barcode berhasil diunggah dan disimpan.":"Pengaturan akses barcode berhasil disimpan."};
}

function uploadFaceProof_(p) {
  const u=requireSession_(p.token);
  const txId=String(p.transactionId||"");
  if(!txId) throw new Error("ID transaksi wajib diisi.");
  const sh=SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEETS.TRANSACTIONS);
  const vals=sh.getDataRange().getValues(),idx=headerMap_(vals.shift());
  const tx=vals.find(r=>String(r[idx.transaction_id])===txId && String(r[idx.sender_id])===String(u.user_id));
  if(!tx) throw new Error("Transaksi tidak ditemukan atau bukan milik akun ini.");
  return saveFaceProof_(u,txId,String(p.dataUrl||""));
}
function saveFaceProof_(u,transactionId,data) {
  const m=String(data||"").match(/^data:image\/(jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/);
  if(!m || m[2].length>5000000) throw new Error("Foto selfie tidak valid atau terlalu besar.");
  const bytes=Utilities.base64Decode(m[2]);
  const blob=Utilities.newBlob(bytes,"image/jpeg","selfie-"+u.user_id+"-"+Date.now()+".jpg");
  const folderId=PropertiesService.getScriptProperties().getProperty("FACE_PROOF_FOLDER_ID");
  const file=folderId?DriveApp.getFolderById(folderId).createFile(blob):DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.VIEW);
  append_("FaceProofs",["FP-"+Utilities.getUuid().slice(0,8).toUpperCase(),u.user_id,String(transactionId||""),file.getUrl(),new Date(),"NEW"]);
  return {ok:true,message:"Foto bukti berhasil disimpan untuk ditinjau admin."};
}
function adminDeleteFaceProof_(p) {
  requireAdmin_(p.token);
  const sh=SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName("FaceProofs"), vals=sh.getDataRange().getValues(), idx=headerMap_(vals.shift());
  const ri=vals.findIndex(r=>String(r[idx.proof_id])===String(p.proofId)); if(ri<0) throw new Error("Bukti tidak ditemukan.");
  const url=String(vals[ri][idx.file_url]||""), id=(url.match(/[-\w]{25,}/)||[])[0];
  if(!id) throw new Error("ID file Drive tidak ditemukan. Data bukti tidak dihapus.");
  try {
    const file=DriveApp.getFileById(id);
    file.setTrashed(true);
  } catch(e) {
    throw new Error("Foto gagal dihapus dari Google Drive. Periksa izin Drive akun pemilik Apps Script. Data bukti tetap dipertahankan.");
  }
  sh.deleteRow(ri+2); return {ok:true,message:"Foto dan data bukti berhasil dihapus."};
}
function barcodeEnabled_() {
  // TRUE = barcode dapat dibuka setiap hari. FALSE = mode jadwal Rabu.
  const raw = getSetting_("BARCODE_ENABLED");
  const value = String(raw ?? "").trim().toLowerCase();
  return ["true", "1", "on", "yes", "enabled"].includes(value);
}
function barcodeAvailableToday_() {
  // Jika akses setiap hari aktif, selalu tersedia. Jika tidak, hanya Rabu (Asia/Jakarta).
  return barcodeEnabled_() || Utilities.formatDate(new Date(), "Asia/Jakarta", "u") === "3";
}
function getSetting_(key) {
  const sh=SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName("Settings"); if(!sh||sh.getLastRow()<2)return "";
  const v=sh.getDataRange().getValues(), idx=headerMap_(v.shift()), row=v.find(r=>String(r[idx.key])===key); return row ? String(row[idx.value] ?? "") : "";
}
function setSetting_(key,value,by) {
  const sh=SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName("Settings");
  if(!sh) throw new Error("Sheet Settings tidak ditemukan. Jalankan setupSheets() terlebih dahulu.");
  const vals=sh.getDataRange().getValues();
  if(!vals.length) { sh.appendRow(HEADERS.Settings); }
  const idx=headerMap_(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]);
  if(idx.key===undefined || idx.value===undefined) throw new Error("Kolom key dan value pada Sheet Settings tidak ditemukan.");
  const rows=sh.getDataRange().getValues().slice(1);
  const ri=rows.findIndex(r=>String(r[idx.key])===key), now=new Date();
  if(ri<0) sh.appendRow([key,value,by,now]);
  else sh.getRange(ri+2,idx.value+1,1,3).setValues([[value,by,now]]);
  CacheService.getScriptCache().remove(key);
}

// Jalankan satu kali dari editor Apps Script untuk memunculkan otorisasi Drive.
function authorizeDriveAccess() {
  const name=DriveApp.getRootFolder().getName();
  return "Akses Google Drive berhasil diotorisasi: "+name;
}
function createAdminAccount() {
  const sh=SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName("Users");
  const vals=sh.getDataRange().getValues(), idx=headerMap_(vals.shift());
  if(vals.some(r=>String(r[idx.user_id])==="ADMIN001")) throw new Error("Akun admin sudah ada.");
  const props=PropertiesService.getScriptProperties(), username=props.getProperty("ADMIN_USERNAME")||"admin", password=props.getProperty("ADMIN_INITIAL_PASSWORD");
  if(!password || password.length<12) throw new Error("Atur Script Property ADMIN_INITIAL_PASSWORD minimal 12 karakter terlebih dahulu.");
  sh.appendRow(["ADMIN001",username,"Administrator",sha256_(password),0,new Date(),"active"]);
  invalidateUserCache_();
}

function requireSession_(token) {
  if (!token) throw new Error("Session tidak ditemukan.");
  const cache = CacheService.getScriptCache();
  const cached = cache.get("SESSION_" + token);
  if (cached) {
    const item = JSON.parse(cached);
    if (new Date(item.expires_at).getTime() >= Date.now()) return item.user;
    cache.remove("SESSION_" + token);
  }

  // Fallback hanya jika session tidak ada di cache (mis. setelah cold start/cache eviction).
  const sessions = recentRows_("Sessions", 200);
  const s = sessions.find(x => String(x.token) === String(token));
  if (!s) throw new Error("Session tidak valid.");
  if (new Date(s.expires_at).getTime() < Date.now()) throw new Error("Session kedaluwarsa.");
  const u = activeUsers_().find(x => String(x.user_id) === String(s.user_id));
  if (!u) throw new Error("User tidak aktif.");
  cacheSession_(token, u, new Date(s.expires_at));
  return u;
}

function findOtherUser_(userId) {
  return activeUsers_().find(u => String(u.user_id) !== String(userId)) || null;
}

function activeUsers_() {
  const cache = CacheService.getScriptCache();
  const key = "ACTIVE_USERS";
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const users = rows_("Users").filter(u => String(u.status).toLowerCase() === "active");
  cache.put(key, JSON.stringify(users), 60);
  return users;
}

function invalidateUserCache_() {
  CacheService.getScriptCache().remove("ACTIVE_USERS");
}

function cacheSession_(token, user, expires) {
  const seconds = Math.max(30, Math.min(21600, Math.floor((new Date(expires).getTime() - Date.now()) / 1000)));
  CacheService.getScriptCache().put("SESSION_" + token, JSON.stringify({ user:user, expires_at:new Date(expires).toISOString() }), seconds);
}

function publicUser_(u) {
  return { user_id:u.user_id, username:u.username, display_name:u.display_name, balance:Number(u.balance)||0, status:u.status };
}

function recentRows_(sheetName, maxRows) {
  const sh = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(sheetName);
  if (!sh) throw new Error("Sheet " + sheetName + " belum dibuat. Jalankan setupSheets().");
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return [];
  const start = Math.max(2, lastRow - maxRows + 1);
  const values = sh.getRange(start, 1, lastRow - start + 1, sh.getLastColumn()).getValues();
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return values.filter(r => r.some(v => v !== "")).map(r => {
    const o = {}; headers.forEach((h,i) => o[String(h)] = r[i]); return o;
  });
}

function rows_(sheetName) {
  const sh = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(sheetName);
  if (!sh) throw new Error("Sheet " + sheetName + " belum dibuat. Jalankan setupSheets().");
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values.shift();
  return values.filter(r => r.some(v => v !== "")).map(r => {
    const o = {};
    headers.forEach((h,i) => o[String(h)] = r[i]);
    return o;
  });
}

function serializeRows_(arr) {
  return arr.map(o => {
    const x = {};
    Object.keys(o).forEach(k => {
      const v = o[k];
      x[k] = v instanceof Date ? v.toISOString() : v;
    });
    return x;
  });
}

function append_(sheetName, values) {
  SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(sheetName).appendRow(values);
}

function getSpreadsheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("SPREADSHEET_ID belum diatur di Script Properties.");
  return id;
}

function headerMap_(headers) {
  const o = {};
  headers.forEach((h,i) => o[String(h)] = i);
  return o;
}

function sha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2,"0")).join("");
}

function formatRupiah_(n) {
  return "Rp" + Number(n).toLocaleString("id-ID");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function safeMessage_(err) {
  return err && err.message ? err.message : "Terjadi kesalahan server.";
}