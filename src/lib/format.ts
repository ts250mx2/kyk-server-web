// Formateadores compartidos para la UI (es-MX).
const moneyFmt = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const intFmt = new Intl.NumberFormat('es-MX');

export function fmtMoney(value: number): string {
    return moneyFmt.format(value || 0);
}

export function fmtInt(value: number): string {
    return intFmt.format(value || 0);
}

export function fmtTamano(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

export function fmtHora(value: string | Date | null | undefined): string {
    if (!value) return '—';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

// Formato dd/mm/aa hh:mm, como los campos de fecha del sistema VB6.
export function fmtFechaHora(value: string | Date | null | undefined): string {
    if (!value) return '—';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-MX', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

// Porcentaje almacenado como fracción (0.16 → "16%").
export function fmtPct(fraccion: number): string {
    const pct = (fraccion || 0) * 100;
    const redondeado = Math.round(pct * 100) / 100;
    return `${redondeado}%`;
}

export function fmtFechaLarga(value: string | Date | null | undefined): string {
    // Las fechas 'YYYY-MM-DD' se interpretan como locales (new Date las tomaría como UTC).
    const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00:00`
        : value;
    const d = normalized ? (normalized instanceof Date ? normalized : new Date(normalized)) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const texto = d.toLocaleDateString('es-MX', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}
