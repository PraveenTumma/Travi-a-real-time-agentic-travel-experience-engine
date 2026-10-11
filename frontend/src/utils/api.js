// Base URL of the backend API. Empty VITE_API_BASE means same origin (Vercel /api or the dev proxy).
export const API_BASE = import.meta.env.VITE_API_BASE || window.location.origin;
