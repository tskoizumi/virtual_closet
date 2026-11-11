// 線画アイコン（絵文字は使わない）
const S = ({ children, size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
export const IconToday = (p) => <S {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></S>;
export const IconCloset = (p) => <S {...p}><path d="M12 8.5c0-1.2 1.6-1.4 1.6-2.9A1.6 1.6 0 0 0 12 4a1.6 1.6 0 0 0-1.6 1.6" /><path d="M12 8.5 3.6 15c-.9.7-.4 2 .7 2h15.4c1.1 0 1.6-1.3.7-2L12 8.5Z" /></S>;
export const IconShop = (p) => <S {...p}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /></S>;
export const IconAdvice = (p) => <S {...p}><path d="M4 5h16v11H9.5L5.5 19.5V16H4V5Z" /></S>;
export const IconSettings = (p) => <S {...p}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></S>;
export const IconClose = (p) => <S {...p}><path d="M5 5l14 14M19 5 5 19" /></S>;
export const IconPlus = (p) => <S size={16} {...p}><path d="M12 5v14M5 12h14" /></S>;
export const IconCamera = (p) => <S size={18} {...p}><path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z" /><circle cx="12" cy="13.5" r="3.2" /></S>;
export const IconImage = (p) => <S size={18} {...p}><rect x="4" y="5" width="16" height="14" /><path d="m4 16 4.5-4.5 4 4 2.5-2.5 5 5" /><circle cx="15.5" cy="9.5" r="1.2" /></S>;
export const IconCheck = (p) => <S size={16} {...p}><path d="m5 12.5 4.500 4.500L19 7.500" /></S>;
