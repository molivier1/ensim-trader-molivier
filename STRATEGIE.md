# Stratégie de trading

Le portefeuille utilise une règle différente pour chaque produit.

## A : profiter des cycles

Le prix de A a oscillé autour d'un niveau relativement stable dans l'historique observé. La stratégie cherche à acheter dans les zones basses et à vendre dans les zones hautes.

- Les seuils sont fixes : **4,40** pour la zone basse et **5,40** pour la zone haute.
- Au-delà de 1 000 unités détenues, elle attend que le pic estimé approche avant de vendre progressivement l'excédent, même si le prix est entre les deux seuils.
- En dessous ou au niveau du seuil bas, elle achète progressivement jusqu'à 1 000 unités au maximum, selon le budget disponible.
- Au-dessus ou au niveau du seuil haut, elle vise la vente progressive de toute la position, près du pic estimé.
- Entre les deux seuils, elle conserve la position une fois l'excédent vendu.

Le pic est estimé avec le même modèle sinusoïdal et la même tendance que le graphique, sur les 240 derniers prix au maximum. La vente démarre lorsque le pic estimé est dans un nombre de ticks inférieur ou égal au nombre de ventes nécessaires ; elle reste autorisée jusqu'à cinq ticks après le pic estimé. Avec moins de 160 observations, ou si aucun pic ne peut être estimé, le script attend et ne vend pas A. Le modèle est recalculé à chaque exécution : son estimation peut changer et ne garantit ni le pic réel ni une vente complète avant mardi.

Ces seuils reflètent les cycles observés et ne garantissent ni un rebond ni une vente au sommet. La cible est exprimée en unités et n'entraîne pas de rééquilibrage lié aux variations de la valeur du portefeuille.

## B : conserver une position de fond

B est conservé **sans nouvel achat ni vente** pour le moment. Le signal reste à zéro quelle que soit sa part dans le portefeuille : il n'y a plus de rééquilibrage vers 20 %.

Si B baisse, la position détenue perd de la valeur. Aucun filtre de tendance ou stop automatique n'est appliqué : cette règle ne vend pas même si B dépasse 20 % du portefeuille ou si son prix baisse fortement.

## C : réduire la position

La tendance historique de C est baissière. La stratégie ne fait aucun nouvel achat et demande la vente progressive de toute la position, sans attendre un éventuel rebond.

## Exécution et réserve

Chaque demande est limitée à 100 unités par produit et par tick. Atteindre une cible ou vendre une grande position peut donc prendre plusieurs ticks. Le signal représente une demande, pas une transaction confirmée : par exemple, `1` demande l'achat de 100 unités et `-1` leur vente.

Les achats sont limités par le cash disponible, en gardant une réserve de 50 au prix connu lors du calcul. Les ventes prévues ne sont pas comptées dans ce budget. Le marché exécute toutefois les ordres à son nouveau prix : si les prix montent entre le calcul et l'exécution, la réserve de 50 n'est pas garantie. Les parts effectives peuvent également changer avec les prix et la limite de 100 unités.

Le workflow prévu toutes les 30 minutes recalcule les demandes et met à jour le journal. Le marché peut réutiliser la dernière demande si le workflow prend du retard : une demande ancienne peut donc être exécutée à nouveau. Le tableau de bord montre les demandes générées, sans confirmer leur exécution.
