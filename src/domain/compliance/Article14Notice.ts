/**
 * Bloc d'information prevu a l'article 14 du RGPD, a joindre a tout premier
 * contact fonde sur des donnees non collectees aupres de la personne.
 *
 * Il est genere par le domaine et concatene au message par le use case :
 * l'utilisateur ne peut ni le modifier, ni le supprimer. La CNIL exige que
 * l'information soit fournie "au plus tard au moment de la premiere
 * communication" et qu'elle mentionne la SOURCE des donnees.
 */
export interface DataControllerIdentity {
  readonly agencyName: string;
  readonly postalAddress: string;
  readonly dpoContact: string;
  readonly oppositionUrl: string;
}

export function buildArticle14Notice(identity: DataControllerIdentity): string {
  return [
    'Information sur le traitement de vos donnees',
    '',
    `Responsable de traitement : ${identity.agencyName}, ${identity.postalAddress}.`,
    'Finalite : vous proposer un service d’estimation et d’accompagnement a la vente.',
    'Base legale : interet legitime du responsable de traitement (art. 6.1.f RGPD).',
    'Source des donnees : donnees publiques ouvertes — diagnostics de performance',
    'energetique publies par l’ADEME (licence Etalab 2.0) et transactions',
    'immobilieres publiees dans la base DVF. Aucune donnee ne provient d’un',
    'fichier nominatif ni d’un annuaire.',
    'Categories traitees : adresse du bien, caracteristiques techniques du logement,',
    'indicateurs de marche du quartier. Aucune donnee relative a votre identite,',
    'votre situation personnelle, financiere ou de sante n’est traitee.',
    'Duree de conservation : 24 mois pour les indicateurs, 3 ans pour la preuve',
    'de la presente information.',
    'Vos droits : acces, rectification, effacement, limitation, et surtout',
    'OPPOSITION a tout nouveau contact, que vous pouvez exercer sans motif.',
    `Pour vous opposer : ${identity.oppositionUrl} ou ${identity.dpoContact}.`,
    'Votre opposition sera appliquee immediatement et vaudra pour l’ensemble des',
    'agences utilisant la plateforme DPE Radar AI.',
    'Vous pouvez introduire une reclamation aupres de la CNIL (www.cnil.fr).',
  ].join('\n');
}

/** Verifie qu'un message sortant n'a pas ete ampute de son bloc d'information. */
export function containsArticle14Notice(message: string): boolean {
  return (
    message.includes('Information sur le traitement de vos donnees') &&
    message.includes('OPPOSITION') &&
    message.includes('ADEME')
  );
}
