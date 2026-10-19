# Explosion — source Blender

Ouvrir `explosion-source.blend` dans Blender. La scène est autonome : aucun
cache de simulation, texture externe ou extension n'est nécessaire. La caméra
et les matériaux sont déjà configurés ; l'image 15 montre le pic du brasier.

La scène dure 3,2 secondes à 60 images/seconde, avec des clés aux temps exacts
des 64 captures exportées. Les 13 premières captures couvrent les 0,24 premières
secondes pour conserver l'impulsion très rapide. Le tableau `frameTimes` des
métadonnées donne les temps de lecture. Les volumes de fumée, le feu, leur
turbulence et la lumière sont animés. Il s'agit de volumes
3D procéduraux composés pour cette explosion, et non d'une simulation de fluide
Mantaflow. Le moteur utilisé pour les textures livrées est Eevee Next.

Sept poches de feu se propagent au sol, tandis qu'une poche centrale conserve
le volume bombé du brasier. La suie apparaît dans ces mêmes poches après un
court retard, roule vers l'extérieur, puis monte lentement. Sa disparition se
fait par érosion de la densité plutôt que par transparence uniforme. Les
matériaux sont séparés : `Soot_*`, `Flame_*`, `Tongue_*` et `Core_*`.
Les valeurs `Density`, `Heat` et `Erosion` de chaque matériau, ainsi
que les coordonnées temporelles des textures Noise, sont modifiables.

Le script `scripts/explosion-volumetric.py` régénère la scène, les rendus HDR,
l'atlas RGBA transparent et son masque de chaleur. Son export applique une
compression des hautes lumières qui préserve l'orange. Le rendu brut dans Blender peut donc
paraître plus intense que la texture utilisée dans le jeu.

Commande depuis le dossier du projet, en remplaçant `blender` par son chemin :

```text
blender -b --factory-startup --python scripts/explosion-volumetric.py -- artifacts/explosion-render
```

Les réglages facultatifs sont `SIZE` (256), `SAMPLES` (64), `ENGINE`
(`BLENDER_EEVEE`), `PREVIEW=1`, `TIME` (0,24 seconde) ou `PREVIEW_TIMES`
(`0.06,0.12,0.24,0.5`). Les images HDR finales restent disponibles dans
`artifacts/explosion-final-v6/frames`.

L'atlas de jeu contient 8 × 8 cases de 256 pixels, soit 2048 × 2048 pixels.
Le masque de chaleur est linéaire : il ne faut pas lui appliquer une conversion
sRGB. La caméra correspond à l'offset `(8, 8.2, 10)` de la scène Three.js ;
chaque case couvre 7,8 mètres et est centrée à 0,85 mètre au-dessus du point
de détonation. Les débris, étincelles, éclairages et reflets au sol sont ajoutés
séparément en temps réel dans le jeu.
