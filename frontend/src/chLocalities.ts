// Auto-complétion NPA suisse (chantiers) — dataset statique embarqué,
// dérivé de la liste officielle des localités CH (zauberware/postal-codes-
// json-xml-csv, lui-même généré depuis post.ch), sans dépendance réseau :
// marche offline, instantané, jamais de rate-limit/panne côté fournisseur.
// Variantes case-postale ("Genève 16", "Aarau 1", ...) filtrées à la source
// pour ne garder que les localités "principales".
//
// Coûte ~170 Ko (non gzippé) — chargé en dynamic import() depuis les
// formulaires chantier seulement (Dashboard.tsx / ChantierDetail.tsx), donc
// jamais dans le bundle principal chargé au démarrage de l'app.
//
// Limite honnête : ~4300 localités officielles, pas les hameaux/lieux-dits.
// Un NPA introuvable ici reste saisissable à la main — le champ n'est jamais
// verrouillé en lecture seule.

export interface ChLocality {
    v: string; // ville / localité
    n: string; // NPA
    c: string; // code canton (2 lettres)
}

let cache: ChLocality[] | null = null;
let loading: Promise<ChLocality[]> | null = null;

async function load(): Promise<ChLocality[]> {
    if (cache) return cache;
    if (!loading) {
        loading = import('./chLocalities.data.json').then(mod => {
            cache = (mod.default ?? mod) as unknown as ChLocality[];
            return cache;
        });
    }
    return loading;
}

// Extrait la localité candidate d'une adresse en une ligne du type
// "Rue de la Gare 12, Leytron" (convention du placeholder du champ) : le
// dernier segment après la dernière virgule, ou la chaîne entière si pas de
// virgule (adresse saisie comme juste un nom de ville).
export function extractLocalityCandidate(addressWork: string): string {
    const parts = addressWork.split(',');
    return parts[parts.length - 1].trim();
}

// Suggestions pour un dropdown d'auto-complétion — préfixe, insensible à la
// casse, 8 résultats max. Chaîne vide/trop courte -> aucune suggestion (évite
// de proposer les 4300 entrées au premier caractère tapé).
export async function suggestLocalities(query: string): Promise<ChLocality[]> {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const data = await load();
    const out: ChLocality[] = [];
    for (const entry of data) {
        if (entry.v.toLowerCase().startsWith(q)) {
            out.push(entry);
            if (out.length >= 8) break;
        }
    }
    return out;
}

// Auto-remplissage silencieux : ne renvoie un NPA que si la localité tapée
// correspond à EXACTEMENT une entrée du dataset — une localité au nom
// ambigu (même nom dans deux cantons) laisse le champ NPA intact, l'admin
// choisit alors dans les suggestions plutôt que de se voir imposer une
// valeur qui pourrait être la mauvaise.
export async function exactNpaMatch(query: string): Promise<ChLocality | null> {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const data = await load();
    const matches = data.filter(e => e.v.toLowerCase() === q);
    return matches.length === 1 ? matches[0] : null;
}
