export type PakistanBank = {
  slug: string;
  name: string;
  legal_name: string;
  category: string;
  parser_status: "supported" | "planned";
  aliases: string[];
};

const BANKS: PakistanBank[] = [
  { slug: "meezan", name: "Meezan", legal_name: "Meezan Bank Limited", category: "islamic", parser_status: "supported", aliases: ["meezan bank", "meezan"] },
  { slug: "hbl", name: "HBL", legal_name: "Habib Bank Limited", category: "scheduled", parser_status: "supported", aliases: ["habib bank limited", "habib bank", "hbl"] },
  { slug: "ubl", name: "UBL", legal_name: "United Bank Limited", category: "scheduled", parser_status: "supported", aliases: ["united bank limited", "united bank", "ubl"] },
  { slug: "nayapay", name: "NayaPay", legal_name: "NayaPay", category: "digital", parser_status: "planned", aliases: ["nayapay", "naya pay"] },
  { slug: "nbp", name: "NBP", legal_name: "National Bank of Pakistan", category: "scheduled", parser_status: "planned", aliases: ["national bank of pakistan", "nbp"] },
  { slug: "mcb", name: "MCB", legal_name: "MCB Bank Limited", category: "scheduled", parser_status: "planned", aliases: ["mcb bank", "mcb"] },
  { slug: "alfalah", name: "Bank Alfalah", legal_name: "Bank Alfalah Limited", category: "scheduled", parser_status: "planned", aliases: ["bank alfalah", "alfalah"] },
  { slug: "faysal", name: "Faysal Bank", legal_name: "Faysal Bank Limited", category: "islamic", parser_status: "planned", aliases: ["faysal bank", "faysal"] },
  { slug: "sadapay", name: "SadaPay", legal_name: "SadaPay", category: "digital", parser_status: "planned", aliases: ["sadapay", "sada pay"] },
  { slug: "easypaisa", name: "Easypaisa", legal_name: "Easypaisa", category: "digital", parser_status: "planned", aliases: ["easypaisa", "telenor microfinance"] },
];

export function pakistanBanksSummary() {
  const by_parser_status: Record<string, number> = {};
  const by_category: Record<string, number> = {};
  for (const b of BANKS) {
    by_parser_status[b.parser_status] = (by_parser_status[b.parser_status] || 0) + 1;
    by_category[b.category] = (by_category[b.category] || 0) + 1;
  }
  return {
    country: "PK",
    currency: "PKR",
    total: BANKS.length,
    by_parser_status,
    by_category,
    banks: BANKS.map(({ slug, name, legal_name, category, parser_status }) => ({
      slug,
      name,
      legal_name,
      category,
      parser_status,
    })),
    source_note:
      "Scheduled banks and digital wallets for detection. Dedicated parsers where parser_status=supported.",
  };
}
