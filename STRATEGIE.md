# Stratégie de trading

Le portefeuille utilise une règle différente pour chaque produit.

## A : profiter des cycles

Le prix de A a oscillé autour d'un niveau relativement stable dans l'historique observé. La stratégie cherche à acheter dans les zones basses et à vendre dans les zones hautes.

- Elle classe les 60 derniers prix, prix actuel compris. Le seuil bas est le 12e prix de cette liste et le seuil haut le 48e.
- Au-delà de 1 000 unités détenues, elle vend progressivement l'excédent, même si le prix est entre les deux seuils.
- En dessous ou au niveau du seuil bas, elle achète progressivement jusqu'à 1 000 unités au maximum, selon le budget disponible.
- Au-dessus ou au niveau du seuil haut, elle vend progressivement toute la position.
- Entre les deux seuils, elle conserve la position une fois l'excédent vendu. S'il y a moins de 60 prix ou si les deux seuils sont identiques, elle attend pour acheter ou sortir en zone haute, mais peut toujours alléger au-delà de 1 000 unités.

Les seuils évoluent avec les prix : un prix bas ne garantit pas que A remontera. La cible est exprimée en unités et n'entraîne pas de rééquilibrage lié aux variations de la valeur du portefeuille.

## B : conserver une position de fond

B est conservé **sans nouvel achat ni vente** pour le moment. Le signal reste à zéro quelle que soit sa part dans le portefeuille : il n'y a plus de rééquilibrage vers 20 %.

Si B baisse, la position détenue perd de la valeur. Aucun filtre de tendance ou stop automatique n'est appliqué : cette règle ne vend pas même si B dépasse 20 % du portefeuille ou si son prix baisse fortement.

## C : réduire la position

La tendance historique de C est baissière. La stratégie ne fait aucun nouvel achat et demande la vente progressive de toute la position, sans attendre un éventuel rebond.

## Exécution et réserve

Chaque demande est limitée à 100 unités par produit et par tick. Atteindre une cible ou vendre une grande position peut donc prendre plusieurs ticks. Le signal représente une demande, pas une transaction confirmée : par exemple, `1` demande l'achat de 100 unités et `-1` leur vente.

Les achats sont limités par le cash disponible, en gardant une réserve de 50 au prix connu lors du calcul. Les ventes prévues ne sont pas comptées dans ce budget. Le marché exécute toutefois les ordres à son nouveau prix : si les prix montent entre le calcul et l'exécution, la réserve de 50 n'est pas garantie. Les parts effectives peuvent également changer avec les prix et la limite de 100 unités.

Le workflow prévu toutes les 30 minutes recalcule les demandes et met à jour le journal. Le marché peut réutiliser la dernière demande si le workflow prend du retard : une demande ancienne peut donc être exécutée à nouveau. Le tableau de bord montre les demandes générées, sans confirmer leur exécution.
