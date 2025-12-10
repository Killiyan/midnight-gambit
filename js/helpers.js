//Adding Handlebars range for Strain later
Handlebars.registerHelper("range", function (start, end, options) {
  let result = "";
  for (let i = start; i <= end; i++) {
    result += options.fn(i);
  }
  return result;
});

Handlebars.registerHelper("riskShouldFill", function (index, dice, used) {
  return index <= (dice - used);
});

//Adding Handlebars range for Strain later
Handlebars.registerHelper("range", function (start, end, options) {
  let result = "";
  for (let i = start; i <= end; i++) {
    result += options.fn(i);
  }
  return result;
});

Handlebars.registerHelper("riskShouldFill", function (index, dice, used) {
  return index <= (dice - used);
});

Handlebars.registerHelper("json", function(context) {
  return JSON.stringify(context, null, 2);
});

Handlebars.registerHelper("capitalize", str => {
  return str.charAt(0).toUpperCase() + str.slice(1);
});

Handlebars.registerHelper("subtract", function(a, b) {
  return a - b;
});

Handlebars.registerHelper("sparkShouldFill", function(index, total, used) {
  const remaining = total - used;
  return index <= remaining;
});

//Filter Items Handlebar
Handlebars.registerHelper("filterItems", function(items, type) {
  return items.filter(item => item.type === type);
});

Handlebars.registerHelper("eq", function(a, b) {
  return a === b;
});

Handlebars.registerHelper("join", function(array, separator) {
  return Array.isArray(array) ? array.join(separator) : "";
});

Handlebars.registerHelper("includes", function(array, value) {
  return Array.isArray(array) && array.includes(value);
});

Handlebars.registerHelper("findTag", function (tags, id) {
  if (!Array.isArray(tags)) {
    console.warn("findTag called with invalid tags list:", tags, "for id:", id);
    return undefined;
  }

  const tag = tags.find(t => t.id === id);
  if (!tag) {
    console.warn(`Tag ID '${id}' not found in provided tag list`, tags);
  }

  return tag;
});

Handlebars.registerHelper("findTag", function (tags, id) {
  if (!Array.isArray(tags)) return undefined;
  const tag = tags.find(t => t.id === id);
  return tag || { id, label: id, custom: true }; // fallback for unknown tags
});

// Join array helper for templates: {{join someArray ", "}}
if (typeof Handlebars !== "undefined" && !Handlebars.helpers?.join) {
  Handlebars.registerHelper("join", function(arr, sep) {
    if (!Array.isArray(arr)) return "";
    return arr.join(typeof sep === "string" ? sep : ", ");
  });
}

if (!Handlebars.helpers.includes) {
  Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));
}

if (!Handlebars.helpers.and) {
  Handlebars.registerHelper("and", (a, b) => !!a && !!b);
}

Handlebars.registerHelper("stripHTML", function (value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]+>/g, "")   // remove tags
    .replace(/&nbsp;/g, " ")    // remove non-breaking spaces
    .trim();
});