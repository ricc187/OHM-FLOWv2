/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                // Modern Blue/Yellow Palette
                background: '#001233', // Deep Midnight Blue
                surface: '#001845',    // Slightly lighter blue
                'surface-light': '#002855', // Lighter blue surface

                primary: '#FFD700',    // Gold/Yellow (unchanged)
                'primary-dark': '#B8860B', // Dark Goldenrod

                secondary: '#0466c8',  // Stronger Blue
                accent: '#0353a4',     // Royal Blue Accent

                text: '#e0e7ff',       // Blue-tinted white for better harmony
                "text-muted": '#94a3b8', // Blue-grey for secondary text

                // Ohm Flow Design System (Legacy + New)
                ohm: {
                    bg: '#001233',
                    surface: '#001845',
                    primary: '#FFD700',
                    secondary: '#0466c8',
                    "text-main": '#e0e7ff',
                    "text-muted": '#94a3b8',
                },
                status: {
                    future: '#cbd5e1',
                    active: '#FFD700',
                    done: '#064e3b',
                }
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
                display: ['Outfit', 'sans-serif'], // For Headings
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
                'glass': 'linear-gradient(145deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%)',
                'glass-hover': 'linear-gradient(145deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
                'ohm-mix': 'linear-gradient(135deg, #FFD700 0%, #3b82f6 100%)', // Gold to Blue mix
            },
            boxShadow: {
                'glow': '0 0 20px rgba(255, 215, 0, 0.15)',
                'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
                'neon': '0 0 20px rgba(255, 215, 0, 0.5)',
                'neon-hover': '0 0 30px rgba(255, 215, 0, 0.6)',
            },
            animation: {
                'fade-in': 'fadeIn 0.6s ease-out forwards',
                'slide-up': 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                'slide-in-right': 'slideInRight 0.5s ease-out forwards',
                'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'gradient-xy': 'gradient-xy 15s ease infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                slideUp: {
                    '0%': { transform: 'translateY(20px)', opacity: '0' },
                    '100%': { transform: 'translateY(0)', opacity: '1' },
                },
                slideInRight: {
                    '0%': { transform: 'translateX(-20px)', opacity: '0' },
                    '100%': { transform: 'translateX(0)', opacity: '1' },
                },
                'gradient-xy': {
                    '0%, 100%': {
                        'background-size': '400% 400%',
                        'background-position': 'left center'
                    },
                    '50%': {
                        'background-size': '200% 200%',
                        'background-position': 'right center'
                    }
                }
            }
        },
    },
    plugins: [],
}
