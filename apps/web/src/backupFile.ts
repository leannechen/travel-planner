// The file name of a Trip's backup: its title made safe for a file name, then "-backup.json".
export function backupFileName(title: string): string {
  const name = Array.from(title.normalize("NFKC"))
    .map((c) => (c.charCodeAt(0) < 32 ? " " : c))
    .join("")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return `${name || "trip"}-backup.json`;
}

// Hands the text to the browser as a file to save.
export function saveTextFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
