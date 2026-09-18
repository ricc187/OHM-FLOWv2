import React, { useEffect, useRef, useState } from 'react';
import { ChLocality, exactNpaMatch, extractLocalityCandidate, suggestLocalities } from '../../chLocalities';

interface Props {
    // Adresse complète du chantier (le champ "Rue, Ville...") — la localité
    // candidate est extraite du dernier segment après la dernière virgule
    // (voir extractLocalityCandidate).
    addressWork: string;
    value: string;
    onChange: (npa: string) => void;
}

// Petit champ NPA à côté du champ adresse existant : se remplit tout seul
// dès qu'une localité suisse reconnue sans ambiguïté est tapée (dataset
// statique, voir chLocalities.ts), sinon propose une liste de suggestions
// cliquables. Reste un champ texte normal, éditable à la main à tout moment
// (le dataset ne couvre que les localités officielles, pas les hameaux).
export const NpaField: React.FC<Props> = ({ addressWork, value, onChange }) => {
    const [suggestions, setSuggestions] = useState<ChLocality[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    // Ne jamais écraser un NPA que l'admin vient lui-même de taper à la main
    // dans CE champ — seule la frappe dans l'adresse déclenche l'auto-fill.
    const lastAutoFilled = useRef<string | null>(null);

    useEffect(() => {
        const candidate = extractLocalityCandidate(addressWork);
        let cancelled = false;
        if (candidate.length < 2) {
            setSuggestions([]);
            return;
        }
        (async () => {
            const exact = await exactNpaMatch(candidate);
            if (cancelled) return;
            if (exact && (value === '' || value === lastAutoFilled.current)) {
                onChange(exact.n);
                lastAutoFilled.current = exact.n;
                setSuggestions([]);
                return;
            }
            const list = await suggestLocalities(candidate);
            if (!cancelled) setSuggestions(list);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressWork]);

    const pick = (loc: ChLocality) => {
        onChange(loc.n);
        lastAutoFilled.current = loc.n;
        setSuggestions([]);
        setShowSuggestions(false);
    };

    return (
        <div className="relative">
            <input
                type="text"
                className="input-field w-24"
                placeholder="NPA"
                maxLength={10}
                value={value}
                onChange={e => { lastAutoFilled.current = null; onChange(e.target.value); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            />
            {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-20 mt-1 w-56 max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl py-1">
                    {suggestions.map((s, i) => (
                        <button
                            key={`${s.v}-${s.n}-${i}`}
                            type="button"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => pick(s)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-left hover:bg-ohm-primary/10 transition-colors"
                        >
                            <span className="font-medium text-slate-700 truncate">{s.v} <span className="text-slate-400">({s.c})</span></span>
                            <span className="font-mono font-bold text-slate-500 shrink-0">{s.n}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
