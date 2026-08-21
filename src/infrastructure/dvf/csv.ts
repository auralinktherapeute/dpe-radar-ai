/**
 * Lecteur CSV minimal, suffisant pour les exports geo-dvf.
 * Gere les champs entre guillemets et les guillemets doubles echappes.
 * On evite une dependance externe pour garder l'adaptateur autonome.
 */
export function parseCsv(content: string): Record<string, string>[] {
  const rows = splitRows(content);
  const header = rows.shift();
  if (!header) return [];

  const records: Record<string, string>[] = [];
  for (const row of rows) {
    if (row.length === 1 && row[0] === '') continue;
    const record: Record<string, string> = {};
    header.forEach((column, index) => {
      record[column] = row[index] ?? '';
    });
    records.push(record);
  }
  return records;
}

function splitRows(content: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
