// Registrasi PWA. File ini aman dipanggil dari semua halaman.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
      .catch((error) => console.warn("PWA service worker gagal didaftarkan:", error));
  });
}
