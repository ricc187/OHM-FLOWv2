/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                background: '#0f172a', // slate-900
                surface: '#1e293b',    // slate-800
                primary: '#facc15',    // yellow-400
                secondary: '#3b82f6',  // Blue
                accent: '#10b981',     // Emerald Green
                text: '#f8fafc',       // slate-50
                "text-muted": '#94a3b8', // slate-400

                // Ohm Flow Design System
                ohm: {
                    bg: '#0f172a',        // slate-900 (Main background)
                    surface: '#1e293b',   // slate-800 (Cards, buttons)
                    primary: '#facc15',   // yellow-400 (Brand color, active states)
                    "text-main": '#f8fafc', // slate-50 (Headings, primary text)
                    "text-muted": '#94a3b8', // slate-400 (Subtitles, secondary text)
                },
                status: {
                    future: '#cbd5e1',   // slate-300 (Gris/Bleu pâle)
                    active: '#facc15',   // yellow-400 (Brand)
                    done: '#064e3b',     // emerald-900 (Vert foncé)
                }
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            animation: {
                'fade-in': 'fadeIn 0.5s ease-out',
                'slide-up': 'slideUp 0.5s ease-out',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(10px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                }
            }
        },
    },
    plugins: [],
}
