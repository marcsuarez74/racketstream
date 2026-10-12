# Projet de CGV — offre payante RacketStream (NON PUBLIÉ)

Brouillon du 2026-10-12, à faire relire par un avocat ou un juriste avant toute vente. Les passages `[entre crochets]` sont à compléter. Ce fichier n'est pas déployé (`deploy-portal.sh` ne publie que `portal/`).

## A. À faire AVANT d'encaisser le premier euro

| # | Obligation | Pourquoi |
|---|---|---|
| 1 | **Se déclarer micro-entrepreneur** sur formulaires.guichet-entreprises.fr (activité : prestation de services numériques, BNC ou BIC selon le code APE attribué) → obtenir un **SIRET**. | Vendre de façon régulière sans être déclaré = travail dissimulé. |
| 2 | **Mettre à jour les mentions légales** : nom et prénom, adresse (ou domiciliation), SIRET, e-mail, téléphone. L'anonymat n'est plus possible pour un professionnel. | LCEN art. 6 III et 19. |
| 3 | Mention **« TVA non applicable, article 293 B du CGI »** sur le site et les factures, tant que le CA reste sous le seuil de franchise. | Code général des impôts. |
| 4 | **Médiateur de la consommation** : adhérer à un médiateur (ex. CM2C, Médicys…, quelques dizaines d'euros/an) si des **particuliers** peuvent acheter. Inutile si l'offre est réservée aux clubs (associations, entreprises). | C. consommation art. L. 612-1. |
| 5 | **Prestataire de paiement** (Stripe, SumUp, PayPal…) : aucune donnée de carte ne passe par notre serveur. Le citer dans la politique de confidentialité (destinataire + éventuel transfert hors UE). | RGPD art. 13 ; PCI-DSS. |
| 6 | **Comptes clients** : si l'offre payante crée des comptes (e-mail), mettre à jour la politique de confidentialité (nouvelles données, durées : facturation 10 ans, compte jusqu'à résiliation + 3 ans de prospection). | RGPD ; C. commerce art. L. 123-22. |
| 7 | **Factures** numérotées avec mentions obligatoires (SIRET, date, désignation, prix, mention 293 B). Facturation électronique obligatoire pour les micro-entreprises en B2B : réception dès sept. 2026, émission à partir de sept. 2027 — vérifier le calendrier en vigueur. | CGI art. 242 nonies A. |
| 8 | **Assurance RC professionnelle** : non obligatoire, recommandée. | — |
| 9 | Publier ces CGV sur `portal/cgv.html`, case à cocher « J'accepte les CGV » avant paiement, e-mail de confirmation reprenant les CGV (support durable). | C. consommation art. L. 221-13. |

## B. Texte du projet

### 1. Vendeur
[Prénom Nom], entrepreneur individuel, [adresse], SIRET [n°], e-mail [contact], téléphone [n°]. TVA non applicable, article 293 B du CGI.

### 2. Champ d'application
Les présentes conditions générales de vente (CGV) s'appliquent à toute souscription d'une offre payante RacketStream, par un client professionnel (club, association, entreprise) ou consommateur. Elles complètent les conditions générales d'utilisation (CGU). En cas de contradiction, les CGV prévalent pour les offres payantes.

### 3. Offres et prix
- Description des offres : [ex. « Club » — terrains supplémentaires, page club personnalisée, incrustation vidéo…], détaillée sur la page Tarifs.
- Prix en euros, **TVA non applicable (art. 293 B du CGI)** : le prix affiché est le prix payé.
- Abonnement [mensuel / annuel], payable d'avance, renouvelé tacitement par période identique.
- Le vendeur peut modifier ses prix pour les périodes suivantes, en prévenant le client par e-mail **au moins un mois** avant le renouvellement ; le client peut alors résilier sans frais.

### 4. Commande
Le client choisit l'offre, renseigne [club, e-mail de facturation], accepte les CGV et paie en ligne. La commande est ferme après paiement. Un e-mail de confirmation récapitule la commande, les CGV et la facture.

### 5. Paiement
Par carte bancaire via [prestataire], qui traite seul les données de paiement. En cas d'échec de paiement au renouvellement, le service payant est suspendu après [7] jours et un rappel ; les fonctions gratuites restent accessibles.

### 6. Droit de rétractation (consommateurs uniquement)
- Le client consommateur dispose de **14 jours** à compter de la souscription pour se rétracter, sans motif, en écrivant à [contact] (formulaire type en annexe).
- S'il demande expressément que le service commence avant la fin de ce délai, il paie le prix au prorata de l'utilisation jusqu'à sa rétractation (C. consommation art. L. 221-25).
- Remboursement sous 14 jours, par le même moyen de paiement.
- Les clients professionnels (clubs, associations agissant pour leur activité) ne bénéficient pas de ce droit, sauf professionnel de moins de 5 salariés hors champ de son activité principale (art. L. 221-3).

### 7. Durée, résiliation
- Résiliation à tout moment depuis [l'espace club / par e-mail], effective à la fin de la période payée ; pas de remboursement de la période en cours, sauf manquement du vendeur.
- **Consommateurs** : rappel par e-mail de la possibilité de ne pas reconduire, 1 à 3 mois avant l'échéance d'un abonnement annuel (C. consommation art. L. 215-1) ; résiliation « en trois clics » via une fonction en ligne accessible (art. L. 215-1-1).
- Le vendeur peut résilier en cas de manquement grave aux CGU, après mise en demeure restée sans effet [15] jours, sauf urgence (contenu illicite, atteinte à la sécurité).

### 8. Disponibilité et support
- Objectif de disponibilité : [99 %] mensuel, hors maintenance annoncée. Pas de garantie de résultat (dépendance au réseau, au Bluetooth, aux plateformes de diffusion).
- Support par e-mail, réponse sous [2] jours ouvrés.
- En cas d'interruption imputable au vendeur supérieure à [24 h] consécutives, avoir au prorata sur la période suivante.

### 9. Garanties légales (consommateurs)
Le vendeur est tenu de la **garantie légale de conformité des contenus et services numériques** (C. consommation art. L. 224-25-12 et s.) pendant toute la durée de fourniture. Le client peut obtenir la mise en conformité ou, à défaut, une réduction de prix ou la résolution du contrat.

### 10. Responsabilité
Responsabilité du vendeur limitée, pour les clients professionnels, aux sommes payées au cours des 12 derniers mois et aux dommages directs. Aucune limitation en cas de faute lourde ou dolosive, ni à l'égard des consommateurs au-delà de ce que la loi permet.

### 11. Données personnelles
Voir la politique de confidentialité. Données de facturation conservées 10 ans (obligation comptable).

### 12. Médiation et litiges
- Réclamation d'abord à [contact].
- **Consommateurs** : à défaut d'accord sous 2 mois, recours gratuit au médiateur [nom, site web], conformément à l'article L. 612-1 du Code de la consommation.
- Droit français. Litiges entre professionnels : tribunaux de [ville du vendeur]. Consommateurs : tribunal du lieu de leur domicile ou de celui du vendeur, à leur choix.

### Annexe — Formulaire de rétractation
> À l'attention de [Prénom Nom], [adresse], [e-mail] :
> Je vous notifie par la présente ma rétractation du contrat portant sur la fourniture du service ci-dessous : [offre], souscrit le [date].
> Nom du consommateur : … — Adresse : … — Date : … — Signature (si papier).
