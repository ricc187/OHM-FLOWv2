import React, { useEffect, useRef, useState } from 'react';
import { ChLocality, exactNpaMatch, localityByNpa, suggestLocalities } from '../../chLocalities';

interface Props {
    // Nom de ville tel quel (champ "Commune / Localité") — contrairement à
    // "Adresse Travaux", ce n'est pas une adresse composée, donc comparé
    // directement au dataset, sans en extraire un segment.
    city: string;
    onCityChange: (city: string) => void;
    value: string;
    onChange: (npa: string) => void;
}

// Petit champ NPA à côté de "Commune / Localité", bidirectionnel :
// - ville tapée -> NPA auto-rempli si la localité est reconnue sans
//   ambiguïté (dataset statique, voir chLocalities.ts) ;
// - NPA tapé directement -> nom de ville auto-rempli, même principe de
//   prudence.
// Sinon propose une liste de suggestions cliquables. Reste un champ texte
// normal, éditable à la main à tout moment (le dataset ne couvre que les
// localités officielles, pas les hameaux).
export const NpaField: React.FC<Props> = ({ city, onCityChange, value, onChange }) => {
    const [suggestions, setSuggestions] = useState<ChLocality[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    // Ne jamais écraser un NPA que l'admin vient lui-même de taper à la main
    // dans CE champ — seule la frappe de la ville déclenche l'auto-fill.
    const lastAutoFilledNpa = useRef<string | null>(null);
    // Même garde dans l'autre sens : ne jamais écraser une ville déjà tapée
    // à la main — seule la frappe du NPA (quand la ville est encore vide,
    // ou vaut ce qu'on y a nous-même écrit) déclenche l'auto-fill.
    const lastAutoFilledCity = useRef<string | null>(null);

    // Ville -> NPA
    useEffect(() => {
        const candidate = city.trim();
        let cancelled = false;
        if (candidate.length < 2) {
            setSuggestions([]);
            return;
        }
        (async () => {
            const exact = await exactNpaMatch(candidate);
            if (cancelled) return;
            if (exact && (value === '' || value === lastAutoFilledNpa.current)) {
                onChange(exact.n);
                lastAutoFilledNpa.current = exact.n;
                setSuggestions([]);
                return;
            }
            const list = await suggestLocalities(candidate);
            if (!cancelled) setSuggestions(list);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [city]);

    // NPA -> ville (sens inverse)
    useEffect(() => {
        const candidate = city.trim();
        if (candidate !== '' && candidate !== lastAutoFilledCity.current) return;
        let cancelled = false;
        (async () => {
            const loc = await localityByNpa(value);
            if (cancelled || !loc || loc.v === candidate) return;
            onCityChange(loc.v);
            lastAutoFilledCity.current = loc.v;
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const pick = (loc: ChLocality) => {
        onChange(loc.n);
        lastAutoFilledNpa.current = loc.n;
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
                onChange={e => { lastAutoFilledNpa.current = null; onChange(e.target.value); }}
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
