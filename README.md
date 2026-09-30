# calendrier-ffe-web

Interface web de test de l'API `calendrier-ffe-api`. Pages statiques (HTML, CSS, JS sans compilation) servies par nginx.

## Lancer

L'API doit tourner (voir `../calendrier-ffe-api`), puis :

```bash
cp .env.example .env   # puis adapter les ports si besoin
docker compose up -d --build
```

Ouvrir http://127.0.0.1:8080 (ou le port choisi dans `WEB_PORT`)

- Réglages dans `.env` (copier `.env.example`) :
  - `WEB_PORT` : port de l'interface sur la machine (8080 par défaut) ; `WEB_BIND` : adresse d'écoute (`127.0.0.1` par défaut) ;
  - `API_URL` : adresse de l'API vue depuis le navigateur (par défaut `http://127.0.0.1:8765`, à aligner sur `API_PORT` de l'API).
  On peut aussi la changer directement dans le bandeau de la page (elle est mémorisée dans le navigateur),
  ou via `?api=` dans l'URL.
- Le dossier `public/` est monté dans le conteneur : une modification est visible au simple rechargement de la page.

## Fonctions

- Filtres : sources, armes, catégories, région / département, ville, période, niveau FFE, individuel / équipe.
  Les filtres sont reportés dans l'URL de la page (on peut la partager ou la mettre en favori).
- Vue **Liste** (par mois) et vue **Mois** (grille calendrier), avec une mise en page pour l'**impression**.
- Clic sur une compétition : détail, note d'organisation, site de l'organisateur, ajout de l'événement à Google Agenda.
- **S'abonner / exporter** : URL du flux `.ics` correspondant aux filtres, téléchargement, lien d'abonnement Google Agenda
  (l'abonnement ne marche qu'une fois l'API publiée sur une URL publique).
