/* Pengingat menabung (hanya aktif di aplikasi Android; di browser biasa tidak berbuat apa-apa). */
(function () {
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return;
  const LN = cap.Plugins && cap.Plugins.LocalNotifications;
  if (!LN) return;

  // Hari pengingat: 1=Minggu, 2=Senin, 3=Selasa, 4=Rabu, 5=Kamis, 6=Jumat, 7=Sabtu.
  // Ubah menjadi [1,2,3,4,5,6,7] bila ingin setiap hari.
  const REMINDER_WEEKDAYS = [4];
  // Jam pengingat (waktu HP).
  const REMINDER_TIMES = [ {hour:0, minute:0}, {hour:12, minute:0}, {hour:18, minute:0} ];

  async function setup() {
    try {
      let perm = await LN.checkPermissions();
      if (perm.display !== "granted") perm = await LN.requestPermissions();
      if (perm.display !== "granted") return;

      const pending = await LN.getPending();
      if (pending.notifications && pending.notifications.length) await LN.cancel({ notifications: pending.notifications });

      const notifications = [];
      REMINDER_WEEKDAYS.forEach((weekday, d) => REMINDER_TIMES.forEach((t, i) => notifications.push({
        id: 100 + d * 10 + i,
        title: "Waktunya menabung 💰",
        body: "Hari ini hari Rabu, barcode menabung sudah terbuka. Jangan lupa menabung!",
        schedule: { on: { weekday, hour: t.hour, minute: t.minute }, allowWhileIdle: true },
        channelId: "reminder"
      })));

      try { await LN.createChannel({ id: "reminder", name: "Pengingat menabung", importance: 4, visibility: 1 }); } catch (_) {}
      await LN.schedule({ notifications });
    } catch (e) { console.warn("Pengingat gagal diatur:", e); }
  }
  setup();
})();
