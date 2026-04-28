/**
 * Formats a given Date object or the current time as a continuous string of numbers
 * in the format YYYYMMDDHHmmss, typically used for appending a unique timestamp to a filename.
 *
 * @param {Date} [date=new Date()] - The Date object to format. Defaults to the current date and time.
 * @returns {string} The formatted timestamp string.
 */
export function formatTimestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

// Attach to window for non-module scripts if window is available
if (typeof window !== "undefined") {
  window.formatTimestampForFilename = formatTimestampForFilename;
}
