import { redirect } from 'next/navigation';

/**
 * Die Startseite hat keinen eigenen Inhalt. Die Middleware hat an dieser Stelle
 * bereits entschieden, ob eine Session existiert — wer hier ankommt, ist
 * angemeldet und will zu seinen Notebooks.
 */
export default function RootPage() {
  redirect('/notebooks');
}
