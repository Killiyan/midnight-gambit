export const MG_REACT_SKILLS = ["endure", "sleight", "grit", "deceive", "hunt", "command"];

export const MG_SKILL_BUCKETS = {
	tenacity: ["brawl", "athletics", "endure"],
	finesse: ["aim", "stealth", "sleight"],
	resolve: ["will", "composure", "grit"],
	guile: ["lore", "investigate", "deceive"],
	instinct: ["survey", "hunt", "nature"],
	presence: ["command", "charm", "perform"],
	react: MG_REACT_SKILLS
};
export const MG_ATTRIBUTE_KEYS = Object.keys(MG_SKILL_BUCKETS);

// A skill's default roll still uses its original attribute.
const MG_SKILL_ATTRIBUTE_MAP = {
	brawl: "tenacity", endure: "tenacity", athletics: "tenacity",
	aim: "finesse", stealth: "finesse", sleight: "finesse",
	will: "resolve", grit: "resolve", composure: "resolve",
	lore: "guile", investigate: "guile", deceive: "guile",
	survey: "instinct", hunt: "instinct", nature: "instinct",
	command: "presence", charm: "presence", perform: "presence",
	spark: "guile"
};

export function mgGetSkillAttribute(skillKey, attribute) {
	return attribute === "react" && MG_REACT_SKILLS.includes(skillKey)
		? "react"
		: MG_SKILL_ATTRIBUTE_MAP[skillKey];
}
