/**
 * Jalankan seedDemoUsers() SATU KALI setelah setupSheets().
 * Password demo:
 *   usera / UserA123!
 *   userb / UserB123!
 *
 * Setelah itu ganti password sebelum penggunaan nyata.
 */
function seedDemoUsers() {
  const sh = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEETS.USERS);
  const existing = rows_("Users");
  if (existing.length) throw new Error("Users sudah berisi data. Seed dibatalkan.");

  const now = new Date();
  sh.getRange(2,1,2,7).setValues([
    ["A001","usera","User A",sha256_("UserA123!"),500000,now,"active"],
    ["B001","userb","User B",sha256_("UserB123!"),750000,now,"active"]
  ]);

  const settings = SpreadsheetApp.openById(getSpreadsheetId_()).getSheetByName(SHEETS.SETTINGS);
  if (settings.getLastRow() < 2) settings.appendRow(["SAVING_PRICE",100000,"A001",now]);
}