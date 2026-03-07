/**
 * Triggers a file download in the browser.
 *
 * @param {string} filename - The name of the file to be downloaded.
 * @param {string|Blob|ArrayBufferView} content - The content of the file.
 * @param {string} mimeType - The MIME type of the file.
 */
export function downloadBlob(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Attach to window for non-module scripts if window is available
if (typeof window !== 'undefined') {
  window.downloadBlob = downloadBlob;
}
