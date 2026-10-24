# STARWARD — portage Godot 4

Le jeu en cours de migration vers Godot 4.7. Le plan complet, les conventions et l’avancement sont dans [`docs/MIGRATION_GODOT.md`](../docs/MIGRATION_GODOT.md).

## Jouer

Ouvrir `godot/project.godot` dans Godot 4.7, puis F5 (ou `godot --path godot`).

- **ZQSD / WASD** (selon la position des touches, le clavier AZERTY comme QWERTY) ou **flèches** : marcher. **Maj** : sprinter.
- **Manette** : stick gauche, l’allure suit son inclinaison (marche lente, marche, course, sprint).
- **Molette** : rapprocher ou éloigner la caméra ; **R** : recentrer.

## Ce qui est porté (étape 1)

- **Rendu pixel art** : la 3D est rendue dans un `SubViewport` réduit (4 pixels d’écran par pixel), puis agrandie au plus proche ; tonemapping ACES, bloom sur ce qui brille, léger brouillard.
- **Caméra isométrique** orthographique, comme la version web, qui suit le Jedi en anticipant sa course.
- **Le Jedi** : modèle et squelette cuits depuis le code web (`hero.glb`), déplacement (`motion_controller.gd`) et animation par motion capture (`hero_animator.gd`) portés ligne à ligne. Le repos, la marche et la course sont mélangés selon la vitesse, avec la même phase de foulée, les couches procédurales (inclinaison, virage, sprint) et les pieds posés au sol. Le sabre est en main ; la lame se rentre après une seconde d’immobilité.
- **Le labo** : la salle du stage 1 cuite telle quelle (`lab.glb` : pont d’acier, caisses, barils, barrières, murs, porte, transformateur), ses lampes, ses bandes lumineuses, et ses obstacles (le Jedi ne traverse pas les caisses).

Pas encore porté : le manteau simulé, le combat, les stormtroopers et tout le reste (étapes 2 à 7 du plan).

## Cuisson des modèles

Les modèles et les données viennent du code web, sans retouche à la main :

```
node scripts/bake-server.mjs
npm run dev
```

puis ouvrir `http://127.0.0.1:5173/bake.html`. Les fichiers arrivent dans `godot/assets/baked/` (`.glb`) et `godot/assets/data/` (`.json`). Godot les réimporte à l’ouverture du projet.

## Tests

Sans fenêtre, depuis la racine du dépôt :

```
godot --headless --path godot --script res://tests/run_tests.gd
```

Les tests de parité rejouent des traces enregistrées par la version web (`motion-reference.json`, `animator-reference.json`) et doivent retrouver les mêmes valeurs : position, cap, vitesses, rotation de chaque os, hanches, phase de la foulée.

Une image du jeu peut être écrite pour vérification : `godot --path godot -- --screenshot=capture.png`.

## Organisation

- `scripts/feel.gd` : les réglages du jeu (autoload `Feel`), lus depuis `assets/data/feel.json`.
- `scripts/controls.gd` : les commandes (autoload `Controls`).
- `scripts/motion_controller.gd` : le déplacement (port de `src/motion.js`).
- `scripts/hero_animator.gd` : l’animation par motion capture (port de `src/animator.js`).
- `scripts/hero.gd` : le Jedi (modèle, commandes, déplacement, animation, sabre).
- `scripts/obstacles.gd` : les obstacles (port de `obstacleQueries` de `src/lab.js`).
- `scripts/lab_level.gd` : le labo cuit, avec l’éclat de ses lumières.
- `scripts/camera_rig.gd` : la caméra isométrique.
- `scripts/main.gd`, `scenes/main.tscn` : le rendu pixel, la lumière, la scène.
- `tests/` : le lanceur et les tests.
