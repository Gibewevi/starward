# STARWARD — Le laboratoire

Prototype jouable d’action 3D isométrique, consacré au plaisir du déplacement. Jedi fidèle à la planche de référence : épaisse coiffure brune en bol, longue robe brune ouverte jusqu’à mi-mollet, tunique beige, ceinturon, pantalon et bottes sombres, sabre bleu tenu bas. Les pans du manteau sont simulés. Le sol métallique reprend la palette froide et les reflets des références fournies. Un stormtrooper immobile sert de mannequin d’entraînement : on peut le découper librement, puis le relever d’une touche.

## Jouer

Sous Windows, double-cliquer sur **Jouer.bat**. Le prototype compilé est fourni dans `dist/` et se lance avec Node.js, sans téléchargement supplémentaire. Garder la fenêtre du serveur ouverte pendant la partie. Adresse : **http://127.0.0.1:5173/**.

Cliquer une fois dans le jeu pour donner le focus au clavier.

| Commande | Action |
|---|---|
| ZQSD, WASD ou flèches | Marcher à 360°, relativement à l’écran |
| Maj maintenue | Sprinter |
| J | Attaquer ; appuyer à nouveau pour enchaîner le combo |
| K maintenue | Garde (on peut marcher ou courir) |
| T | Relever le stormtrooper intact |
| Molette | Zoom continu |
| R | Revenir au centre |
| Échap | Pause / reprise |
| H | Aide |
| F | Plein écran |
| Manette : stick gauche | Direction ; l’inclinaison règle l’allure : marche lente, marche, course, sprint à fond |
| Manette : B | Attaquer ; appuyer en rythme pour enchaîner |
| Manette : A maintenu | Garde (on peut marcher ou courir) |
| Manette : Y | Relever le stormtrooper |

Sur écran tactile, le joystick et le bouton de course apparaissent automatiquement. Les réglages permettent de choisir la taille des pixels, les reflets, le zoom et le son du sabre. Le son est désactivé par défaut.

## Comportement

- Allure continue au stick : marche lente 0,6 m/s, marche 1,7 m/s, course 3,3 m/s, sprint 4,5 m/s à pleine inclinaison ; au clavier, marche et sprint (Maj). Accélération vive, freinage court et rotation progressive. La cadence reste naturelle pour les jambes courtes du personnage (≈ 2,5 pas/s en marche, 4,4 en sprint).
- Combat au sabre : une bibliothèque de dix-sept mouvements — tailles diagonale et horizontale, revers montant, taille montante, double taille en X, fauchage bas, vrilles dans les deux sens, moulinets puis estocade, hélice au-dessus de la tête — enchaînés au hasard : chaque coup commence là où le précédent a laissé la lame, jamais deux fois le même d’affilée, avec un tempo et une amplitude qui varient. Après trois à six coups, un final ferme le combo (frappe plongeante, vrille sautée, taille montante en saut avec moulinet, fente après trois moulinets). Attaquer lancé ouvre par une estocade ou une vrille en course. Les appuis sont mémorisés, chaque coup se réoriente vers le stick et porte le Jedi vers l’avant ; une traînée bleue dessine les arcs et les moulinets.
- Sabre : la lame jaillit de l’émetteur en 0,3 s avec un léger dépassement et s’accompagne d’un double moulinet de dégainage, que le Jedi soit à l’arrêt ou en mouvement ; le faisceau est plus large au poignet et s’affine vers la pointe.
- Stormtrooper d’entraînement : modèle low-poly modulaire (casque, torse, bassin, bras, avant-bras, mains, cuisses, jambes et bottes, blaster E-11), immobile, arme en main, qui respire et regarde autour de lui. La trajectoire réelle de la lame entre deux images est testée contre une capsule par membre ; le point d’impact choisit la coupe prédéfinie : épaule ou coude, coude ou poignet, hanche ou genou, cou, ou taille si la lame passe à l’horizontale. Un coup lent ne fait qu’étinceler ; un coup bas à la jambe arrache genouillère ou jambière. Un bras coupé le fait vaciller et lâcher son blaster ; tête, taille, jambe ou un coup franc au torse le font tomber. Il passe alors en ragdoll avec des impulsions qui dépendent de l’endroit et de la force du coup : aucune chute n’est identique. Chaque pièce détachée garde son maillage et sa physique, tout comme le blaster. Les coupes sont cautérisées : embouts incandescents qui refroidissent, braises, gerbes d’étincelles, éclair orangé, bref arrêt sur image, secousse et son (sans gore).
- Garde : lame verticale tenue à deux mains devant le buste, genoux fléchis ; on peut marcher ou courir en garde (allure plafonnée à 2,2 m/s). Les tirs ennemis ne sont pas encore codés.
- Animation en capture de mouvement (Mixamo) : repos, marche et course mélangés selon la vitesse avec une phase de pas commune. Tête, cou, trois vertèbres, clavicules, bras, bassin, jambes et orteils bougent comme sur l’acteur capturé. La foulée est élargie pour les proportions du Jedi, la cadence est calibrée sur le squelette au démarrage, et une passe de sol plante les semelles.
- Couches procédurales au-dessus de la capture : inclinaison dans l’accélération et les virages, buste penché en sprint, tête qui regarde dans le virage, bras écartés du manteau, posture campée au repos, sabre porté bas puis traîné en arrière en course.
- Pans du manteau physiques en coordonnées monde : 324 particules enroulées autour des jambes, ouvertes devant, cousues au bassin, poussées par les jambes et soulevées par l’air en course.
- Sabre toujours tenu en main droite. La lame se rétracte après une seconde d’immobilité réelle, puis se rallume dès le mouvement.
- Caméra orthographique avec suivi amorti et légère anticipation.
- Géométrie 3D, ombres dynamiques, réflexion planaire, lumière bleue et halo. Rendu à résolution réduite agrandi en nearest-neighbor ; le halo lumineux est calculé avant cet agrandissement.

Le modèle du personnage a été créé pour ce prototype. Le corps est un maillage continu dont les sommets se déforment avec un squelette de 22 os compatible Mixamo, y compris aux articulations. Un étalonnage propre au personnage lit l’éclairage froid du laboratoire comme une lumière neutre chaude, pour garder les bruns de la référence ; seule la lueur du sabre reste bleue. Les mouvements proviennent des captures Mixamo distribuées avec les exemples three.js (`Xbot.glb`) ; seules les rotations utiles sont conservées dans `src/mocap-clips.js`. Les textures et les polices sont locales. Aucun compte ni accès Internet n’est nécessaire pour jouer une fois les fichiers présents.

## Développement

Node.js 20.19+ ou 22.12+.

```sh
npm install
npm run dev
npm test
npm run build
npm start
```

`npm run dev` démarre le serveur avec rechargement ; `npm start` sert la dernière compilation. En développement, **http://127.0.0.1:5173/atelier.html** montre la référence à côté du personnage rendu en temps réel (repos, marche, course, caméra du jeu à l’échelle réelle).

Pour régénérer les animations : télécharger https://threejs.org/examples/models/gltf/Xbot.glb puis `node scripts/extract-mocap.mjs chemin/vers/Xbot.glb`. WebGL 2 est nécessaire. Clavier et fonctions principales vérifiés dans le navigateur ; les commandes tactiles et manette nécessitent un matériel compatible.

## Organisation

- `src/main.js` : scène, reflets, caméra, entrées et interface.
- `src/lighting.js`, `src/saber.js` : éclairage du laboratoire ; sabre et ses lumières.
- `src/motion.js` : déplacement et automatisme du sabre.
- `src/character.js` : assemblage du personnage (corps, tête, ceinturon, sabre).
- `src/rig.js` : squelette compatible Mixamo et pose de liaison.
- `src/avatar-surface.js` : surface continue du corps habillé et pondération des articulations.
- `src/jedi-head.js` : visage et coiffure.
- `src/character-shading.js` : étalonnage de la lumière sur le personnage.
- `src/animator.js` : lecture et mélange de la capture, couches procédurales, passe de sol, cinématique inverse des bras, visée du sabre.
- `src/combat.js` : chorégraphie des attaques et de la garde (poses clés, enchaînements aléatoires, moulinets, élans, sauts).
- `src/blade-trail.js` : traînée lumineuse de la lame.
- `src/stormtrooper.js` : stormtrooper modulaire, posture, réactions, détection des coups et découpes prédéfinies.
- `src/ragdoll.js` : physique Verlet des membres (articulations, sectionnement, sol, collisions entre membres).
- `src/impact-effects.js` : étincelles, éclairs, braises et refroidissement des coupes.
- `src/ik.js` : cinématique inverse à deux os, partagée par le Jedi et le stormtrooper.
- `src/mocap-clips.js` : clips générés par `scripts/extract-mocap.mjs`.
- `src/coat.js` : pans du manteau simulés.
- `src/sdf.js` : sculpture par champs de distance et polygonisation.
- `src/stage.js` : sol et textures de métal déterministes.
- `atelier.html`, `src/atelier.js` : atelier de comparaison avec la référence (développement uniquement).
- `tests/` : vérifications du maillage, de la capture, des appuis, du manteau et du mouvement.

Projet personnel expérimental inspiré des références fournies ; aucune affiliation officielle.
