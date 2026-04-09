function extractTag(xml: string, tag: string): string | undefined {
  const lowerXml = xml.toLowerCase();
  const lowerTag = tag.toLowerCase();
  const openTag = `<${lowerTag}>`;
  const closeTag = `</${lowerTag}>`;

  const openIndex = lowerXml.indexOf(openTag);
  if (openIndex === -1) {
    return undefined;
  }
  const contentStart = openIndex + openTag.length;
  const closeIndex = lowerXml.indexOf(closeTag, contentStart);
  if (closeIndex === -1) {
    return undefined;
  }

  return xml.slice(contentStart, closeIndex).trim();
}

function extractItems(xml: string, tag: string): readonly string[] {
  const parent = extractTag(xml, tag);
  if (!parent) {
    return [];
  }

  const lowerParent = parent.toLowerCase();
  const openTag = '<item>';
  const closeTag = '</item>';
  const items: string[] = [];

  let cursor = 0;
  while (cursor < parent.length) {
    const openIndex = lowerParent.indexOf(openTag, cursor);
    if (openIndex === -1) {
      break;
    }
    const contentStart = openIndex + openTag.length;
    const closeIndex = lowerParent.indexOf(closeTag, contentStart);
    if (closeIndex === -1) {
      break;
    }
    const item = parent.slice(contentStart, closeIndex).trim();
    if (item.length > 0) {
      items.push(item);
    }
    cursor = closeIndex + closeTag.length;
  }

  return items;
}

function requireTag(xml: string, tag: string): string {
  const value = extractTag(xml, tag);
  if (!value) {
    throw new Error(`invalid_xml_missing_${tag}`);
  }
  return value;
}

export interface ParsedObservationXml {
  readonly type: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly narrative: string;
  readonly facts: readonly string[];
  readonly concepts: readonly string[];
  readonly filesRead: readonly string[];
  readonly filesModified: readonly string[];
}

export interface ParsedSummaryXml {
  readonly request: string;
  readonly investigated: string;
  readonly learned: string;
  readonly completed: string;
  readonly nextSteps: string;
  readonly notes?: string;
  readonly filesRead: readonly string[];
  readonly filesEdited: readonly string[];
  readonly skipSummary: boolean;
}

export function parseObservationXml(xml: string): ParsedObservationXml {
  const subtitle = extractTag(xml, 'subtitle');
  return {
    type: requireTag(xml, 'type'),
    title: requireTag(xml, 'title'),
    subtitle: subtitle && subtitle.length > 0 ? subtitle : undefined,
    narrative: requireTag(xml, 'narrative'),
    facts: extractItems(xml, 'facts'),
    concepts: extractItems(xml, 'concepts'),
    filesRead: extractItems(xml, 'files_read'),
    filesModified: extractItems(xml, 'files_modified'),
  };
}

export function parseSummaryXml(xml: string): ParsedSummaryXml {
  const notes = extractTag(xml, 'notes');
  const skipRaw = extractTag(xml, 'skip_summary') ?? '';
  const skipSummary = /^(true|1|yes)$/i.test(skipRaw.trim());
  return {
    request: extractTag(xml, 'request') ?? '',
    investigated: extractTag(xml, 'investigated') ?? '',
    learned: extractTag(xml, 'learned') ?? '',
    completed: extractTag(xml, 'completed') ?? '',
    nextSteps: extractTag(xml, 'next_steps') ?? '',
    notes: notes && notes.length > 0 ? notes : undefined,
    filesRead: extractItems(xml, 'files_read'),
    filesEdited: extractItems(xml, 'files_edited'),
    skipSummary,
  };
}
