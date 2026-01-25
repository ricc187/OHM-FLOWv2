


export const OhmIcon = ({ className = "w-8 h-8" }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z" />
        <path d="M7 17H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3" />
        <path d="M17 7h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3" />
        <path d="M12 2v5" />
        <path d="M12 17v5" />
    </svg>
);

export const BoltIcon = ({ className = "w-6 h-6" }) => (
    <svg fill="currentColor" viewBox="0 0 24 24" className={className}>
        <path d="M13 10V3L4 14H11V21L20 10H13Z" />
    </svg>
);

export const Logo = () => (
    <div className="flex items-center gap-2 group">
        <div className="relative">
            <div className="bg-ohm-surface p-1.5 rounded-lg border border-slate-700 shadow-xl group-hover:border-ohm-primary transition-colors">
                <OhmIcon className="w-7 h-7 text-ohm-primary" />
            </div>
            <BoltIcon className="absolute -top-1 -right-1 w-4 h-4 text-ohm-primary animate-pulse" />
        </div>
        <span className="text-xl font-extrabold tracking-tighter text-ohm-text-main">
            OHM<span className="text-ohm-primary">FLOW</span>
        </span>
    </div>
);
