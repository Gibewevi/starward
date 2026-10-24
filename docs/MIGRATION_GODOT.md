# Migration de STARWARD vers Godot 4

Ce document est le plan de référence de la migration. La version web (Three.js, dossier `src/`) reste jouable et fait foi tant que chaque système n’a pas été porté et vérifié dans Godot (dossier `godot/`).

## Principe

Le jeu web compte environ 21 000 lignes de JavaScript. Presque tout y est **généré par le code** : le Jedi, son squelette et sa peau, les stormtroopers, les caisses, le labo, la jungle, les textures peintes au pixel. Deux familles de choses à migrer :

1. **Ce qui se voit** (maillages, squelettes, matériaux, textures) : on ne le réécrit pas. Une page de cuisson (`bake.html`) construit chaque modèle avec le vrai code du jeu, dans le navigateur (qui sait peindre les textures), et l’exporte en glTF binaire (`.glb`) dans `godot/assets/baked/`. Godot importe ces fichiers tels quels. Les données (motion capture, réglages `FEEL`, obstacles, postes) sont exportées en JSON dans `godot/assets/data/`.
2. **Ce qui bouge** (déplacement, animation, combat, IA, physique des corps, effets, eau, végétation, interface) : réécrit en GDScript, un module à la fois, en gardant les mêmes formules et les mêmes réglages (`FEEL` est lu depuis le JSON). Chaque module porté a un test de parité : le JS produit une trace de référence, Godot la rejoue et doit retomber sur les mêmes valeurs.

Commandes :

```
node scripts/bake-server.mjs          # reçoit les fichiers cuits (port 5199)
npm run dev                           # puis ouvrir http://127.0.0.1:5173/bake.html
```

Godot 4.7 : ouvrir `godot/project.godot`. Tests sans fenêtre : `godot --headless --path godot --script res://tests/run_tests.gd`.

## Conventions

- Mêmes unités (mètre, seconde, radian) et même repère : Y vers le haut, +Z vers l’avant du personnage, axes du monde identiques (glTF et Godot sont tous deux en Y-up main droite).
- Angles d’Euler : Three.js est en ordre XYZ par défaut ; en GDScript, toujours `Basis.from_euler(v, EULER_ORDER_XYZ)` (l’ordre par défaut de Godot est YXZ).
- Quaternions : `THREE.Quaternion(x, y, z, w)` ↔ `Quaternion(x, y, z, w)` ; `a.premultiply(b)` ↔ `a = b * a`.
- Le squelette du Jedi est exporté en pose de repos (rotations identité, T-pose) : les rotations de motion capture s’appliquent directement avec `set_bone_pose_rotation`.
- Rendu pixel art : la 3D est rendue dans un `SubViewport` réduit (`SubViewportContainer.stretch_shrink` = taille du pixel), agrandi au plus proche ; l’interface reste à pleine résolution.
- Caméra : orthographique, décalage (8 ; 8,2 ; 10) depuis le point suivi, hauteur de vue 8,2 m (12 m dans la jungle).

## Correspondance des modules

| Web (`src/`) | Godot (`godot/`) | Étape |
| --- | --- | --- |
| `feel.js` | `assets/data/feel.json` + `scripts/feel.gd` (autoload `Feel`) | 1 |
| `motion.js` | `scripts/motion_controller.gd` | 1 |
| `character.js`, `rig.js`, `avatar-surface.js`, `jedi-head.js` | `assets/baked/hero.glb` | 1 |
| `animator.js`, `mocap-clips.js`, `ik.js` | `scripts/hero_animator.gd`, `assets/data/mocap.json` | 1 |
| `stage.js`, `lab.js`, `arena.js` | `assets/baked/lab.glb`, `assets/data/lab.json`, `scripts/obstacles.gd` | 1 |
| `lighting.js`, rendu pixel, bloom (`main.js`) | `scripts/main.gd` (Environment, SubViewport) | 1 |
| `saber.js`, `blade-trail.js` | `saber.glb` + `scripts/saber.gd` | 2 |
| `coat.js` | `scripts/coat.gd` (tissu simulé) | 2 |
| `combat.js`, `deflect.js`, `tween.js`, `shake.js` | `scripts/combat/*.gd` | 2 |
| `stormtrooper.js`, `trooper-model.js`, `trooper-gait.js`, `ragdoll.js` | `stormtrooper.glb` + `scripts/trooper/*.gd` | 3 |
| `trooper-ai.js`, `nav.js`, `alerts.js`, `reinforcements.js` | `scripts/ai/*.gd` (AStarGrid2D) | 3 |
| `blasters.js`, `grenades.js`, `explosions.js`, `impact-effects.js`, `scorch-marks.js`, `saber-scars.js`, `debris.js`, `wounds.js`, `footprints.js` | `scripts/fx/*.gd`, particules GPU | 4 |
| `transformer.js`, `power.js`, `flashlights.js`, `beam-pass.js`, `stain-light.js` | `scripts/lab/*.gd`, lumières volumétriques | 4 |
| `hero-ragdoll.js`, mort et relance | `scripts/hero/*.gd` | 4 |
| `duel*.js` | `scripts/duel/*.gd` | 5 |
| `jungle*.js`, `vegetation.js`, `water.js` | `jungle.glb` + shaders Godot (végétation, eau) + `scripts/jungle/*.gd` | 6 |
| `audio.js`, `music.js`, `radio-comms.js` | `AudioStreamPlayer3D`, bus audio | 7 |
| Menu, HUD, réglages (`index.html`, `stage-menu.js`, `pixel-prompt.js`, `telegraph.js`) | scènes `ui/*.tscn` | 7 |

## Étapes

1. **Fondations** : projet Godot, rendu pixel, caméra isométrique, réglages `FEEL`, cuisson des modèles (Jedi, sabre, stormtrooper, labo), déplacement du Jedi (parité avec `motion.js`), animation par motion capture (repos, marche, course, mêmes couches procédurales), collisions avec les caisses du labo, entrées clavier et manette. *Résultat : on marche, court et sprinte dans le labo avec le Jedi animé.*
2. **Sabre et combat** : sabre allumé et sa traînée, manteau simulé, attaques, garde, parade, Force (attraction, projection), déplacement éclair.
3. **Stormtroopers** : modèle, démarche, ragdoll, IA d’escouade, navigation, alertes, renforts par la porte.
4. **Tirs, explosions, effets** : blasters et renvoi de tirs, grenades, explosions, étincelles, brûlures, débris, empreintes, sabotage du transformateur, coupure de courant, lampes des fusils et faisceaux volumétriques ; mort, relance.
5. **Duel contre le Jedi** (stage 1).
6. **Stage 2, ruines du marais** : carte cuite, eau simulée (shader + simulation sur grille), végétation en instances animée par shader, générateurs, nuit aléatoire.
7. **Son, musique, radio, menu, HUD, réglages**, export Windows.

## Avancement

- [x] Étape 1 — Fondations (voir `godot/README.md`). Le mouvement et l’animation sont identiques au web (tests de parité). Restes : le manteau simulé (étape 2) et un calibrage plus fin des lumières (les intensités three.js et Godot ne se correspondent pas une à une).
- [ ] Étape 2 — Sabre et combat
- [ ] Étape 3 — Stormtroopers
- [ ] Étape 4 — Tirs, explosions, effets
- [ ] Étape 5 — Duel
- [ ] Étape 6 — Stage 2
- [ ] Étape 7 — Son, interface, export
