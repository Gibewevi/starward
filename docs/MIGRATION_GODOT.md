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
| `animator.js`, `mocap-clips.js`, `ik.js` | `scripts/hero_animator.gd`, `assets/data/mocap.json` | 1, 2 |
| `stage.js`, `lab.js`, `arena.js` | `assets/baked/lab.glb`, `assets/data/lab.json`, `scripts/obstacles.gd` | 1 |
| `lighting.js`, rendu pixel, bloom (`main.js`) | `scripts/main.gd` (Environment, SubViewport) | 1 |
| `saber.js`, `blade-trail.js` | `saber.glb` + `scripts/saber.gd`, `scripts/blade_trail.gd` | 2 |
| `coat.js` | `scripts/coat.gd` (tissu simulé, sur un fil de calcul) | 2 |
| `combat.js`, `shake.js`, `tween.js` (kick), dash et caméra de `main.js` | `assets/data/combat.json` + `scripts/combat_controller.gd`, `scripts/shake.gd`, `scripts/camera_rig.gd`, `scripts/hero.gd` | 2 |
| Visée des coups (`findMark`, `lockOn`), arrêts sur image, Force sur les troopers, empalement | `scripts/hero.gd`, `scripts/battle.gd` | 3 |
| `deflect.js`, tirs et renvois de `main.js` | `scripts/fx/blasters.gd`, `scripts/battle.gd` | 4 |
| `stormtrooper.js`, `trooper-model.js`, `trooper-gait.js`, `ragdoll.js` | `stormtrooper.glb`, `assets/data/trooper.json` + `scripts/trooper/stormtrooper.gd`, `ragdoll.gd`, `trooper_gait.gd` | 3 |
| `trooper-ai.js`, `nav.js`, `alerts.js`, `reinforcements.js`, porte de `arena.js` | `scripts/ai/squad_mind.gd`, `nav.gd` (l’A* du web, pour retrouver les mêmes chemins), `alerts.gd`, `reinforcements.gd`, `scripts/lab_door.gd` | 3 |
| `blasters.js`, `grenades.js`, `explosions.js`, `impact-effects.js`, `scorch-marks.js`, `saber-scars.js`, `debris.js`, `footprints.js`, `stain-light.js`, lueurs de visée de `telegraph.js` | `scripts/fx/*.gd` (maillages reconstruits chaque image, MultiMesh), `assets/fx/` | 4 |
| `transformer.js`, `power.js`, `flashlights.js`, `beam-pass.js` | `scripts/lab/*.gd`, `shaders/lamp_beam.gdshader` (la passe du web, faisceau par faisceau) | 4 |
| `hero-ragdoll.js`, `wounds.js`, mort et relance | `scripts/hero/*.gd` | 4 |
| `duel*.js` | `scripts/duel/*.gd` | 5 |
| `jungle*.js`, `vegetation.js`, `water.js` | `jungle.glb`, `assets/jungle/`, `assets/data/jungle.json` + `scripts/jungle/*.gd`, `shaders/plants.gdshader`, `shaders/water_step.glsl` (les vagues sur la carte graphique), `shaders/jungle_water.gdshader`, `shaders/jungle_ground.gdshader` | 6 |
| `audio.js`, `music.js`, `radio-comms.js` | `AudioStreamPlayer3D`, bus audio | 7 |
| Menu de sélection des stages (`stage-menu.js`, `menu-pixels.js`) | `scripts/ui/stage_menu.gd`, `scripts/ui/pixel_text.gd`, `assets/ui/menu/` | 7 (fait en avance) |
| HUD, réglages, aide (`index.html`, `pixel-prompt.js`, `telegraph.js`) | `scripts/ui/` | 7 |

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
- [x] Étape 2 — Sabre et combat (voir `godot/README.md`). Le contrôleur de combat et l’IK des bras sont identiques au web (tests de parité sur une trace de 1 100 pas : les 22 coups, la garde, les parades, la Force, l’empalement, le sabotage). Sabre, traînée, manteau simulé, dash, moulinet, secousses de caméra en place. Restent pour les étapes suivantes, parce qu’ils ont besoin des stormtroopers ou des effets : la visée et l’élan vers une cible, les arrêts sur image et les secousses d’impact, le renvoi des tirs, les effets de la Force (vague, corps projetés, décor), la traînée lumineuse du dash, le son. Le manteau tourne sur un fil parallèle : en GDScript sa simulation coûte environ 6 ms par image.
- [x] Étape 3 — Stormtroopers (voir `godot/README.md`). La démarche, le ragdoll seul et la navigation sont identiques au web. Le trooper reprend la même pose debout au millimètre, les mêmes coups, coupes, chutes, relevés et événements ; au sol, le corps est chaotique (Godot diverge de lui-même pour un micromètre), et le test en tient compte. L’escouade pense et agit comme le web pendant 11 s de combat, avant que la simple précision des positions de Godot ne l’en écarte. En jeu : patrouilles, alertes, combat d’escouade, Force, empalement, renforts par la porte ; 140 images/s, environ 85 quand cinq corps tombent à la fois. Restent pour l’étape 4 : les tirs (les troopers tirent à blanc), les grenades, les étincelles, fumées et gouttes rouges (les appels existent, sans effet), le son. La trace web oubliait que le rendu remet à jour les matrices des pièces tombées : la cuisson le fait désormais à chaque pas.
- [x] Étape 4 — Tirs, explosions, effets (voir `godot/README.md`). Grenades, débris et renvois de tirs retrouvent le web (tests de parité ; les débris jusqu’à ce qu’une boîte qui culbute devienne chaotique). En jeu : tirs et renvois, parade parfaite, grenades, explosions en planche Blender avec leur reflet, étincelles, gouttes, débris, brûlures, entailles de lame, empreintes, héros renversé, mort et relance (G coupe le mode invincible en attendant le menu), sabotage du transformateur, coupure de courant, lampes des fusils avec faisceaux et poussière. Les faisceaux sont le calcul de la passe du web, mais sans les ombres des lampes (Godot ne donne pas accès à leurs cartes d’ombre) : un faisceau s’arrête sur ce qui lui barre la route. Environ 90 images/s en plein combat (140 au calme), un peu moins dans le noir avec cinq lampes à ombres. Restent pour l’étape 7 : les flèches au bord de l’écran, l’invite « DÉTRUIRE », la vibration de la manette.
- [ ] Étape 5 — Duel
- [x] Étape 6 — Stage 2 (voir `godot/README.md`), portée avant l’étape 5 à la demande. La carte, les ruines, les générateurs et les données sont cuits depuis le web ; les plantes animées par shader (plus de 13 000 en MultiMesh), l’eau simulée sur la carte graphique (compute shader : la même équation, 60 pas par seconde, sur toute la grille au lieu d’une fenêtre autour de la vue), le sol creusé par les explosions, l’air (rayons de lune, poussière, lucioles), la nuit au hasard, le déroulé (quatre générateurs, vagues de renforts, victoire). Différences : sans carte graphique (vérifications sans fenêtre), l’eau reste plate ; les gouttes lancées par l’eau qui déborde ne sont pas reproduites ; le reflet du sol mouillé non plus. Environ 55 à 60 images/s, 40 en plein combat de nuit.
- [ ] Étape 7 — Son, interface, export
