# STARWARD — portage Godot 4

Le jeu en cours de migration vers Godot 4.7. Le plan complet, les conventions et l’avancement sont dans [`docs/MIGRATION_GODOT.md`](../docs/MIGRATION_GODOT.md).

## Jouer

Ouvrir `godot/project.godot` dans Godot 4.7, puis F5 (ou `godot --path godot`).

- **ZQSD / WASD** (selon la position des touches, le clavier AZERTY comme QWERTY) ou **flèches** : marcher. **Maj** : sprinter.
- **Manette** : stick gauche, l’allure suit son inclinaison (marche lente, marche, course, sprint).
- **J** (manette **B**) : frapper ; un appui pendant un coup enchaîne le suivant, **J maintenu** amène le coup final.
- **K** (**RB**, **LB** ou **A**) : la garde ; un appui pare.
- **Espace** (**Y**) : le déplacement éclair. **E** (**R3**) : faire tournoyer la lame.
- **U** / **I** (**LT** / **RT**) : attirer / repousser avec la Force ; **U maintenu** tient le trooper attiré en l’air devant le héros ; **U et J maintenus** l’empalent.
- **T** (**L3**) : tout recommencer (l’escouade à ses postes, le héros au départ).
- **Molette** : rapprocher ou éloigner la caméra ; **R** : recentrer.

## Ce qui est porté (étape 1)

- **Rendu pixel art** : la 3D est rendue dans un `SubViewport` réduit (4 pixels d’écran par pixel), puis agrandie au plus proche ; tonemapping ACES, bloom sur ce qui brille, léger brouillard.
- **Caméra isométrique** orthographique, comme la version web, qui suit le Jedi en anticipant sa course.
- **Le Jedi** : modèle et squelette cuits depuis le code web (`hero.glb`), déplacement (`motion_controller.gd`) et animation par motion capture (`hero_animator.gd`) portés ligne à ligne. Le repos, la marche et la course sont mélangés selon la vitesse, avec la même phase de foulée, les couches procédurales (inclinaison, virage, sprint) et les pieds posés au sol. Le sabre est en main ; la lame se rentre après une seconde d’immobilité.
- **Le labo** : la salle du stage 1 cuite telle quelle (`lab.glb` : pont d’acier, caisses, barils, barrières, murs, porte, transformateur), ses lampes, ses bandes lumineuses, et ses obstacles (le Jedi ne traverse pas les caisses).

## Ce qui est porté (étape 2)

- **Le combat** (`combat_controller.gd`, port de `src/combat.js`) : les 22 mouvements cuits depuis le web (`combat.json`), enchaînés par le même graphe (chaque coup finit d’un côté, le suivant est tiré parmi ceux qui partent de là, jamais un coup récent), le coup final quand J est maintenu, l’ouverture en course, la garde vivante, les parades, la Force, le moulinet, le dégainé quand la lame s’allume.
- **Les bras** : IK à deux os des deux mains (port de `src/ik.js`), torse qui pivote dans le coup, genoux fléchis, main gauche sur la poignée pour les coups à deux mains.
- **Le sabre** (`saber.gd`) : lame qui jaillit en dépassant un peu puis se rentre, ses deux lumières qui pulsent, l’éclat à l’impact ; **la traînée** lumineuse des coups (`blade_trail.gd`), balayée autour de la poignée pour dessiner des arcs.
- **Le manteau simulé** (`coat.gd`, port de `src/coat.js`) : 324 particules, contraintes, collisions avec le bassin et les jambes, vent relatif de la course. La simulation tourne sur un fil de calcul parallèle (elle coûte quelques millisecondes de GDScript) et le maillage est reconstruit en fin d’image.
- **Le déplacement éclair** et **la caméra** : secousse par traumatisme (`shake.gd`), à-coup dans le sens d’une poussée, zoom bref.

## Ce qui est porté (étape 3)

- **Le stormtrooper** (`trooper/stormtrooper.gd`, port de `src/stormtrooper.js`) : le modèle cuit (`stormtrooper.glb`, une pièce par membre, chaque plaque d’armure à part), un squelette léger, la démarche par motion capture (`trooper/trooper_gait.gd`), les pieds plantés par IK, le fusil à deux mains, la visée épaulée, le tir à l’aveugle par-dessus une caisse, la grenade. Les réactions à chaque coup selon l’endroit touché, la brûlure du premier coup, les membres tranchés aux articulations prévues (moignons qui rougeoient), les plaques qui sautent, l’éclair blanc de l’armure frappée. La Force : projeté sans en mourir, attiré, tenu en l’air en s’étouffant ; relâché, il retombe et s’enfuit ; relevé de force s’il était à terre. Empalé, il se débat puis pend à la lame. À terre vivant, il se recroqueville, se relève, titube et va reprendre son fusil ; une jambe en moins, il rampe jusqu’à l’épuisement ; touché au corps par un tir, il attend qu’un camarade le soigne.
- **Le ragdoll** (`trooper/ragdoll.gd`, port de `src/ragdoll.js`) : particules de Verlet en double précision, corps rigides, butées articulaires, sol, caisses, collisions entre membres (testées seulement pour les paires proches, dans le même ordre que le web), muscles qui portent le corps tant qu’il vit.
- **L’escouade** (`ai/squad_mind.gd`, port de `src/trooper-ai.js`) : la vue (cône, coin de l’œil, caisses qui cachent), l’ouïe (pas, lame, coups, Force, tirs), le « ? » puis le « ! » (`ai/alerts.gd`), l’enquête, l’alerte radio, le plan d’escouade (fonceur, flanqueurs, ancres), les couverts, les rafales échelonnées avec la lueur de visée, le recul face au Jedi, le déploiement en tenaille, le repli, la poursuite, la fouille des cachettes, le sauvetage d’un blessé traîné à l’abri. La navigation sur grille (`ai/nav.gd`, port de `src/nav.js`).
- **Les renforts** (`ai/reinforcements.gd`, `lab_door.gd`) : l’escouade abattue, l’alarme sonne, la grande porte s’ouvre et l’escorte entre en file, puis fait sa ronde.
- **Le héros contre eux** (`hero.gd`, `battle.gd`) : chaque coup trouve sa cible (vers le stick, ou devant), s’y tourne et glisse jusqu’à portée ; un trooper pris par surprise meurt du premier coup ; arrêt sur image sur une coupe nette, secousse et à-coup de caméra ; la Force pousse, attire, tient ; l’empalement ; les troopers debout arrêtent le héros ; tout ce qu’il fait s’entend.

Pas encore porté : les tirs (les troopers visent et tirent, mais à blanc) et leur renvoi, les grenades, les étincelles et autres effets, le duel, le son (étapes 4 à 7 du plan).

## Cuisson des modèles

Les modèles et les données viennent du code web, sans retouche à la main :

```
node scripts/bake-server.mjs
npm run dev
```

puis ouvrir `http://127.0.0.1:5173/bake.html` (`bake.html?only=combat,data` ne cuit que ces parties : `data`, `hero`, `saber`, `combat`, `lab`, `trooper`, `squad`). Les fichiers arrivent dans `godot/assets/baked/` (`.glb`) et `godot/assets/data/` (`.json`). Godot les réimporte à l’ouverture du projet.

## Tests

Sans fenêtre, depuis la racine du dépôt :

```
godot --headless --path godot --script res://tests/run_tests.gd
```

Les tests de parité rejouent des traces enregistrées par la version web (`motion-reference.json`, `animator-reference.json`, `combat-reference.json`, `arms-reference.json`, `gait-reference.json`, `ragdoll-reference.json`, `trooper-reference.json`, `nav-reference.json`, `squad-reference.json`) et doivent retrouver les mêmes valeurs : position, cap, vitesses, rotation de chaque os, hanches, phase de la foulée ; pour le combat, les mêmes coups aux mêmes instants avec les mêmes poses, puis les mêmes bras et la même lame. `-- --only=<nom>` ne lance que les fichiers dont le nom le contient.

Pour les troopers : la démarche, le ragdoll seul et la navigation retombent exactement sur le web. Un corps jeté au sol est chaotique (Godot contre lui-même : un micromètre d’écart au départ donne des centimètres, voire des mètres, à l’arrivée). Le test du trooper exige donc la même pose debout au millimètre, les mêmes coups, coupes et événements, les mêmes états aux mêmes instants jusqu’à ce que ce chaos s’installe, puis le même ordre d’états. L’escouade, dont Godot tient les positions en simple précision, doit penser et agir exactement comme le web pendant au moins 10 secondes de combat (11 aujourd’hui).

Une image du jeu peut être écrite pour vérification : `godot --path godot -- --screenshot=capture.png`, avec au besoin `--frames=<n>`, `--view=<hauteur>` (caméra plus proche), `--at=<x>,<z>[,<cap>]` (où part le héros), `--clear=<secondes>` (toute l’escouade abattue à cet instant : l’escorte arrive) et des appuis programmés, par exemple `--press=0.3:attack,0.5:attack,1.9:force_push` (`3.4:hold:force_pull` … `6:release:force_pull` pour maintenir). La console indique alors les coups joués, l’état de l’escouade et les images par seconde. Pendant une vérification, le clavier et les manettes sont ignorés.

## Organisation

- `scripts/feel.gd` : les réglages du jeu (autoload `Feel`), lus depuis `assets/data/feel.json`.
- `scripts/controls.gd` : les commandes (autoload `Controls`).
- `scripts/motion_controller.gd` : le déplacement (port de `src/motion.js`).
- `scripts/hero_animator.gd` : l’animation par motion capture (port de `src/animator.js`).
- `scripts/hero.gd` : le Jedi (modèle, commandes, déplacement, animation, combat, dash, sabre, manteau).
- `scripts/combat_controller.gd` : la chorégraphie du sabre (port de `src/combat.js`).
- `scripts/saber.gd`, `scripts/blade_trail.gd` : le sabre et sa traînée.
- `scripts/coat.gd` : le manteau simulé.
- `scripts/shake.gd` : la secousse de caméra.
- `scripts/obstacles.gd` : les obstacles (port de `obstacleQueries` de `src/lab.js`) : repousser un marcheur, lancer un segment, trouver un couvert.
- `scripts/lab_level.gd`, `scripts/lab_door.gd` : le labo cuit, avec l’éclat de ses lumières, sa grande porte et les postes de l’escouade.
- `scripts/trooper/` : le stormtrooper, son ragdoll, sa démarche.
- `scripts/ai/` : l’esprit de l’escouade, la navigation, les alertes, les renforts.
- `scripts/fx/impact_effects.gd` : le rougeoiement des coupes et des brûlures (le reste des effets : étape 4).
- `scripts/battle.gd` : l’escouade dans la scène, les coups du héros sur elle, le déroulé du combat.
- `scripts/camera_rig.gd` : la caméra isométrique, ses secousses et ses à-coups.
- `shaders/` : l’éclairage des personnages (partagé par le corps et le manteau), la traînée additive.
- `scripts/main.gd`, `scenes/main.tscn` : le rendu pixel, la lumière, la scène.
- `tests/` : le lanceur et les tests.
