import fs from 'fs';
import path from 'path';

/**
 * Saves JSON data array to a CSV file.
 * Handles commas, quotes, and double quotes escaping correctly.
 * @param {Array<Object>} data
 * @param {Array<{key: string, label: string}>} fields
 * @param {string} filePath
 */
export function saveToCSV(data, fields, filePath) {
  // Ensure the directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const headerRow = fields.map(f => `"${f.label.replace(/"/g, '""')}"`).join(',');
  
  const rows = data.map(row => {
    return fields.map(f => {
      let val = row[f.key];
      if (val === undefined || val === null) {
        val = '';
      } else {
        val = String(val);
      }
      // Escape double quotes and wrap in quotes if contains commas/quotes/newlines
      if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',');
  });

  const csvContent = [headerRow, ...rows].join('\n');
  fs.writeFileSync(filePath, csvContent, 'utf-8');
}

export default {
  saveToCSV
};
