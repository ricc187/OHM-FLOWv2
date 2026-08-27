/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Corporate Trust Palette
                background: '#F8FAFC', // slate-50
                surface: '#FFFFFF',    // white
                'surface-light': '#F1F5F9', // slate-100

                primary: '#2563EB',    // blue-600
                'primary-dark': '#1D4ED8', // blue-700
                'primary-light': '#DBEAFE', // blue-100

                secondary: '#1E3A8A',  // blue-900
                accent: '#0EA5E9',     // sky-500

                text: '#0F172A',       // slate-900
                "text-muted": '#64748B', // slate-500

                // Ohm Flow Design System (Legacy + New mapped to light)
                ohm: {
                    bg: '#F8FAFC',
                    surface: '#FFFFFF',
                    primary: '#2563EB',
                    secondary: '#1E3A8A',
                    "text-main": '#0F172A',
                    "text-muted": '#64748B',
                },
                status: {
                    future: '#CBD5E1', // slate-300
                    active: '#2563EB', // blue-600
                    done: '#059669', // emerald-600
                }
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
                display: ['Inter', 'sans-serif'], // Professional sans for headings
            },
            backgroundImage: {
                'glass': 'linear-gradient(145deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.7) 100%)',
                'glass-hover': 'linear-gradient(145deg, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.85) 100%)',
                'ohm-mix': 'linear-gradient(135deg, #2563EB 0%, #1E3A8A 100%)', // Blue primary gradient
            },
            boxShadow: {
                'glow': '0 0 20px rgba(37, 99, 235, 0.15)',
                'glass': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
            },
            animation: {
                'fade-in': 'fadeIn 0.4s ease-out forwards',
                'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                'slide-in-right': 'slideInRight 0.4s ease-out forwards',
                'pulse-slow': 'pulseSlow 6s ease-in-out infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(10px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                slideInRight: {
                    '0%': { transform: 'translateX(-10px)', opacity: '0' },
                    '100%': { transform: 'translateX(0)', opacity: '1' },
                },
                pulseSlow: {
                    '0%, 100%': { opacity: '0.2' },
                    '50%': { opacity: '0.35' },
                },
            }
        },
    },
    plugins: [],
}
