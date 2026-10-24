# STARWARD — portage Godot 4

Le jeu en cours de migration vers Godot 4.7. Le plan complet, les conventions et l’avancement sont dans [`docs/MIGRATION_GODOT.md`](../docs/MIGRATION_GODOT.md).

## Jouer

Ouvrir `godot/project.godot` dans Godot 4.7, puis F5 (ou `godot --path godot`). Le jeu part dans le labo (stage 1) ; **2** passe aux ruines du marais (stage 2), **1** revient au labo (la partie recommence). `godot --path godot -- --stage=jungle` part directement dans le marais, de jour ou de nuit au hasard (`--night=1` ou `--night=0` pour choisir).

- **ZQSD / WASD** (selon la position des touches, le clavier AZERTY comme QWERTY) ou **flèches** : marcher. **Maj** : sprinter.
- **Manette** : stick gauche, l’allure suit son inclinaison (marche lente, marche, course, sprint).
- **J** (manette **B**) : frapper ; un appui pendant un coup enchaîne le suivant, **J maintenu** amène le coup final.
- **K** (**RB**, **LB** ou **A**) : la garde ; un appui pare.
- **Espace** (**Y**) : le déplacement éclair. **E** (**R3**) : faire tournoyer la lame.
- **U** / **I** (**LT** / **RT**) : attirer / repousser avec la Force ; **U maintenu** tient le trooper attiré en l’air devant le héros ; **U et J maintenus** l’empalent.
- **J** devant le transformateur (ou un générateur du marais), **maintenu** : y planter la lame (la salle est ensuite plongée dans le noir ; dans le marais, la zone du générateur).
- **T** (**L3**) : tout recommencer (l’escouade à ses postes, le héros au départ).
- **G** : mode invincible ou non (invincible par défaut ; en attendant le menu des réglages). Mort : **Entrée** (**Start**), **J**, **K** ou **Espace** pour recommencer.
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

## Ce qui est porté (étape 4)

- **Les tirs** (`fx/blasters.gd`, port de `src/blasters.js` et `src/deflect.js`) : les traits rouges, leur lueur, l’éclair de bouche, la brûlure qu’ils laissent. La lame les renvoie : garde tenue, elle part d’elle-même à la rencontre d’un tir de face, de côté ou dans le dos ; un coup en cours en rabat un ; renvoyé vers un ennemi d’autant plus sûrement que le tireur est proche et le héros entraîné ; parade parfaite (la garde pressée juste avant) droit dans le tireur, avec le reste de sa rafale. Un tir qui atteint le héros attend quelques images contre sa poitrine : une parade à ce moment le renvoie encore. Une lueur rouge au bout du canon annonce chaque rafale (`fx/aim_glints.gd`).
- **Les grenades** (`fx/grenades.gd`) : lancées en cloche, elles rebondissent, roulent, clignotent de plus en plus vite ; un cercle rouge au sol montre leur portée, un second se resserre avec la mèche. La Force les repousse.
- **Les explosions** (`fx/explosions.gd`) : le feu et la fumée en planche d’animation rendue sous Blender (`assets/fx/explosion.png`, seules les parties incandescentes éclairent), l’éclair qui illumine la salle, l’onde de choc, la poussière, le sol qui rougeoit puis refroidit, le reflet du feu dans le métal mouillé. Les troopers proches sont tués ou projetés, le héros renversé.
- **Les effets** (`fx/impact_effects.gd`) : étincelles, braises, gouttes rouges qui tombent, coulent sur les caisses et s’étalent, éclairs, anneaux, vagues de Force ; **les débris** (`fx/debris.gd`) : petites caisses, plaques, bidons, tuyaux épars dans la salle, projetés par une explosion avec des éclats brûlants, bousculés par les pas ; **les brûlures** qui restent (`fx/scorch_marks.gd`) ; **les entailles** de la lame dans les caisses, les murs et le sol, en fusion puis refroidies (`fx/saber_scars.gd`) ; **les empreintes** rouges de qui a marché dans le sang (`fx/footprints.gd`).
- **Le héros renversé** (`hero/hero_ragdoll.gd`, port de `src/hero-ragdoll.js`) : projeté par une explosion, il se protège en vol, roule, puis se relève sur un genou. **La mort** (mode invincible coupé) : un tir ou une explosion suffit ; corps inerte, blessures collées aux os (`hero/wounds.gd`), flaque qui s’étend, lame qui s’éteint, écran « MORT » (`hero/death_screen.gd`) ; un appui, et tout recommence.
- **Le sabotage** (`lab/transformer.gd`) : J maintenu devant le transformateur, le héros arme la lame, puis la plante dans la fenêtre à arcs ; la surcharge monte (étincelles, arcs vers la lame, lumières qui hoquettent), puis tout saute. **La coupure** (`lab/power.gd`) : toutes les lumières de la salle s’éteignent d’un coup, une vague d’étincelles court dans les luminaires, l’escouade perd le héros un instant. **Dans le noir** (`lab/flashlights.gd`) : les troopers allument un à un la lampe sous leur fusil ; chaque faisceau se voit dans l’air poussiéreux (calculé pixel par pixel comme la passe du web, `shaders/lamp_beam.gdshader`), la poussière s’y révèle et tourbillonne au passage du héros ou de sa lame ; la lampe d’un mort clignote puis meurt. Les taches rouges restent sombres sauf là où une lumière les touche (`fx/stain_light.gd`).

Pas encore porté : les flèches au bord de l’écran vers les menaces hors champ, l’invite « DÉTRUIRE » près du transformateur (avec l’interface, étape 7), le duel, le son (étapes 5 à 7 du plan).

## Ce qui est porté (stage 2, les ruines du marais)

Porté avant le duel (étape 5), à la demande.

- **La carte** (`jungle/jungle_level.gd`, port de `src/jungle.js` et `src/jungle-map.js`) : une jungle inondée aux ruines anciennes, semi-ouverte. Depuis l’aire d’atterrissage, on va où l’on veut — par les passerelles, par le cœur des ruines, ou en pataugeant dans les roseaux — vers quatre générateurs à détruire. Les ruines, passerelles, speeder, cage, antenne, rochers, arbres, lierre et générateurs sont cuits depuis le web (`jungle.glb`) ; le sol peint, le placage des ruines et la profondeur de l’eau aussi (`assets/jungle/`) ; les plantes, les pierres, les lampes et toutes les données de la carte dans `jungle.json`. Le placage des ruines est posé dans l’espace du monde (2 m par carreau), comme le web.
- **Les plantes** (`jungle/vegetation.gd`, `shaders/plants.gdshader`) : herbes, roseaux, fougères et grandes feuilles (plus de 13 000), ondulant au vent, écartées par qui passe, coupées par la lame à la hauteur où elle passe (des bouts de feuille volent), balayées par la Force, soufflées puis arrachées par une explosion.
- **L’eau** (`jungle/jungle_water.gd`, `shaders/water_step.glsl`, `shaders/jungle_water.gdshader`) : une vraie simulation de vagues sur une grille de 400 × 400 cases, calculée sur la carte graphique. Chaque pas, chaque corps qui patauge ou tombe, chaque tir, chaque explosion y fait des ronds qui se croisent et rebondissent sur les berges ; l’eau poussée contre une berge déborde en nappe ; la Force la chasse ou l’attire ; une explosion y creuse un trou qui se referme en gerbe, ou ouvre sur la berge un cratère que le courant remplit. Reflets de la lune et des lampes, écume, nénuphars qui suivent les vagues, gouttes.
- **Le sol** (`shaders/jungle_ground.gdshader`) : la boue peinte, son relief, les cratères que creusent les explosions (rebouchés à la relance), le lit du marais teinté sous l’eau.
- **L’air** (`jungle/jungle_air.gd`) : les rayons de lune dans la brume (le calcul des faisceaux des lampes de fusil), la poussière qu’ils révèlent et que le passage du héros fait tourbillonner, les lucioles ; de nuit, la poussière devant les lampes des ruines.
- **Les ruines vivent** : bandes lumineuses, diodes qui clignotent, lanternes, balises ; huit vraies lumières prêtées aux lampes les plus proches ; les cascades. Les empreintes restent dans le sable (pas sur les planches ni les dalles) ; dans l’eau, les pas éclaboussent.
- **Le déroulé** (`battle.gd`, `jungle/objectives.gd`) : quatre générateurs à saboter dans l’ordre qu’on veut. Chacun détruit éteint sa zone et sonne l’alarme : une vague de renforts arrive par la piste derrière le poste de commandement. Le dernier détruit, « VICTOIRE ». À l’écran : le compte des générateurs et un repère sur chacun (au bord de l’écran s’il est hors champ).
- **De nuit** (une partie sur deux, au hasard) : les troopers ont leur lampe de fusil allumée dès le départ et voient moins loin ; dans les roseaux ou en pataugeant, le héros est moins visible. La vue est plus large et les pixels plus fins que dans le labo ; la jungle assombrit les bords de l’écran.

Environ 55 à 60 images/s en se promenant, 40 en plein combat de nuit avec une vingtaine de troopers (le web en a autant : ce sont eux qui coûtent).

Non porté : le reflet du sol mouillé (absent du labo aussi pour l’instant).

## Exécutable Windows

Avec les modèles d’export de Godot 4.7.2 installés (Éditeur → Gérer les modèles d’export), depuis la racine du dépôt :

```
godot --headless --path godot --export-release "Windows Desktop" ../build/STARWARD/STARWARD.exe
```

Un seul fichier, `build/STARWARD/STARWARD.exe` (les données sont dedans). Le préréglage (`godot/export_presets.cfg`) y joint les fichiers que le jeu lit lui-même (`assets/data/*.json`, l’explosion, la profondeur de l’eau) et laisse les tests et les traces de référence.

## Cuisson des modèles

Les modèles et les données viennent du code web, sans retouche à la main :

```
node scripts/bake-server.mjs
npm run dev
```

puis ouvrir `http://127.0.0.1:5173/bake.html` (`bake.html?only=combat,data` ne cuit que ces parties : `data`, `hero`, `saber`, `combat`, `lab`, `trooper`, `squad`, `fx`, `jungle`). Les fichiers arrivent dans `godot/assets/baked/` (`.glb`), `godot/assets/data/` (`.json`) et `godot/assets/fx/` (les textures de brûlure, peintes par le code du web). La planche de l’explosion est copiée telle quelle depuis `public/fx/`. Godot les réimporte à l’ouverture du projet.

## Tests

Sans fenêtre, depuis la racine du dépôt :

```
godot --headless --path godot --script res://tests/run_tests.gd
```

Les tests de parité rejouent des traces enregistrées par la version web (`motion-reference.json`, `animator-reference.json`, `combat-reference.json`, `arms-reference.json`, `gait-reference.json`, `ragdoll-reference.json`, `trooper-reference.json`, `nav-reference.json`, `squad-reference.json`, `fx-reference.json`) ; `test_jungle.gd` vérifie le marais (carte entière, eau et passerelles, cratère, plantes coupées, discrétion dans les roseaux) et doivent retrouver les mêmes valeurs : position, cap, vitesses, rotation de chaque os, hanches, phase de la foulée ; pour le combat, les mêmes coups aux mêmes instants avec les mêmes poses, puis les mêmes bras et la même lame. `-- --only=<nom>` ne lance que les fichiers dont le nom le contient.

Pour les troopers : la démarche, le ragdoll seul et la navigation retombent exactement sur le web. Un corps jeté au sol est chaotique (Godot contre lui-même : un micromètre d’écart au départ donne des centimètres, voire des mètres, à l’arrivée). Le test du trooper exige donc la même pose debout au millimètre, les mêmes coups, coupes et événements, les mêmes états aux mêmes instants jusqu’à ce que ce chaos s’installe, puis le même ordre d’états. L’escouade, dont Godot tient les positions en simple précision, doit penser et agir exactement comme le web pendant au moins 10 secondes de combat (11 aujourd’hui).

Pour les effets : les grenades (rebonds, caisses, roulis, poussée de la Force, explosions) suivent le web au centième de millimètre ; les débris sont posés aux mêmes endroits et projetés de même pendant le premier quart de seconde (ensuite, une boîte qui culbute est chaotique) ; les tirs renvoyés partent dans la même direction, vers le même ennemi.

Une image du jeu peut être écrite pour vérification : `godot --path godot -- --screenshot=capture.png`, avec au besoin `--frames=<n>`, `--view=<hauteur>` (caméra plus proche), `--at=<x>,<z>[,<cap>]` (où part le héros), `--clear=<secondes>` (toute l’escouade abattue à cet instant : l’escorte arrive) `--grenade=<secondes>:<x>:<z>` (une grenade lancée à ce moment vers ce point), `--blast=<secondes>:<x>:<z>` (une explosion), `--mortal` (mode invincible coupé), `--stage=jungle` et `--night=<0|1>` et des appuis programmés, par exemple `--press=0.3:attack,0.5:attack,1.9:force_push` (`3.4:hold:force_pull` … `6:release:force_pull` pour maintenir ; `retry` pour recommencer après la mort). La console indique alors les coups joués, l’état du héros et de l’escouade, les grenades, débris, brûlures et entailles, les images par seconde et le temps de calcul. Pendant une vérification, le clavier et les manettes sont ignorés.

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
- `scripts/fx/` : les tirs, les grenades, les explosions, les effets d’impact, les débris, les brûlures, les entailles, les empreintes, la lumière des taches, les lueurs de visée.
- `scripts/hero/` : le héros renversé, ses blessures, l’écran de mort.
- `scripts/lab/` : le transformateur (et les générateurs du marais), le courant de la salle, les lampes des fusils.
- `scripts/jungle/` : les ruines du marais, leurs plantes, leur eau, leur air, l’affichage des objectifs.
- `scripts/battle.gd` : l’escouade dans la scène, les coups du héros sur elle, les tirs, les explosions, la mort, le sabotage, le déroulé du combat.
- `scripts/camera_rig.gd` : la caméra isométrique, ses secousses et ses à-coups.
- `shaders/` : l’éclairage des personnages (partagé par le corps et le manteau), la traînée additive, les points lumineux et les gouttes, l’explosion et son reflet, les anneaux de souffle, les faisceaux et la poussière des lampes, la lumière des taches.
- `scripts/main.gd`, `scenes/main.tscn` : le rendu pixel, la lumière, la scène.
- `tests/` : le lanceur et les tests.
