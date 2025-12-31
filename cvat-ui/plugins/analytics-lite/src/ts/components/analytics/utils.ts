export function fmtRatio(v: any): string {
    if (typeof v !== 'number' || Number.isNaN(v)) return '-';
    return `${(v * 100).toFixed(2)}%`;
}

export function fmtNum(v: any): string {
    if (typeof v !== 'number' || Number.isNaN(v)) return '-';
    return `${v}`;
}

export function fmtDurationSeconds(sec: number): string {
    if (!Number.isFinite(sec) || sec <= 0) return '-';
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${ss}s`;
    return `${ss}s`;
}

export function parseTsMs(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
    const s = String(value).trim();
    if (!s) return 0;
    const asNum = Number(s);
    if (!Number.isNaN(asNum) && Number.isFinite(asNum)) {
        return asNum > 1e12 ? asNum : asNum * 1000;
    }
    const ms = Date.parse(s);
    return Number.isNaN(ms) ? 0 : ms;
}

export function parseCSV(csvText: string): { headers: string[]; rows: Record<string, string>[] } {
    const text = (csvText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                const next = text[i + 1];
                if (next === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            row.push(field);
            field = '';
        } else if (ch === '\n') {
            row.push(field);
            field = '';
            if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
                rows.push(row);
            }
            row = [];
        } else {
            field += ch;
        }
    }

    if (field.length || row.length) {
        row.push(field);
        if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
            rows.push(row);
        }
    }

    const headers = (rows[0] || []).map((h) => (h || '').trim());
    const dataRows = rows.slice(1);
    const objects: Record<string, string>[] = dataRows.map((r) => {
        const obj: Record<string, string> = {};
        for (let idx = 0; idx < headers.length; idx++) {
            obj[headers[idx] || `col_${idx}`] = r[idx] ?? '';
        }
        return obj;
    });
    return { headers, rows: objects };
}

export async function asyncPool<T, R>(
    limit: number,
    items: T[],
    fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let i = 0;
    const workers = new Array(Math.max(1, limit)).fill(0).map(async () => {
        while (i < items.length) {
            const idx = i;
            i += 1;
            results[idx] = await fn(items[idx], idx);
        }
    });
    await Promise.all(workers);
    return results;
}


