/**
 * One section of a long text page (Terms, Privacy, Refund, About). `id` is the anchor and is the
 * same in every language; `paragraphs` come first, then `items` as a bullet list. `{name}`-style
 * placeholders are filled from code (operator, plans, cookie lifetimes) when the page renders.
 */
export type LegalSection = {
  heading: string;
  id: string;
  items: string[];
  paragraphs: string[];
};

export type LegalPageCopy = {
  description: string;
  lede: string;
  sections: LegalSection[];
  title: string;
};
