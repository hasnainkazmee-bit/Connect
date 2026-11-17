use super::*;
pub(super) fn id_list(v: &Value, key: &str, max: usize) -> Result<Vec<String>> {
    let Some(a) = v.get(key) else {
        return Ok(Vec::new());
    };
    let a = a
        .as_array()
        .ok_or_else(|| bad("Check the selected items."))?;
    if a.len() > max {
        return Err(bad("Too many selected items."));
    }
    let mut ids = Vec::new();
    for v in a {
        let id = v.as_str().ok_or_else(|| bad("Invalid identifier."))?;
        checked_id(id)?;
        if ids.iter().any(|x: &String| x.eq_ignore_ascii_case(id)) {
            return Err(bad("An item was selected more than once."));
        }
        ids.push(id.to_ascii_lowercase());
    }
    Ok(ids)
}
pub(super) fn rules(v: &Value) -> Result<Value> {
    let a = v.as_array().ok_or_else(|| bad("Check community rules."))?;
    if a.len() > 12 {
        return Err(bad("Use up to 12 community rules."));
    }
    let mut out = Vec::new();
    for r in a {
        out.push(json!({"title":req(r,"title",1,120)?,"body":txt(r,"body",1500)?}));
    }
    Ok(json!(out))
}
pub(super) fn topics(v: &Value, old: &Value) -> Result<Value> {
    let a = v.as_array().ok_or_else(|| bad("Check community topics."))?;
    if a.len() > 20 {
        return Err(bad("Use up to 20 topics."));
    }
    let mut ids = HashSet::new();
    let mut out = Vec::new();
    for t in a {
        let id = uid(t, "id")?.ok_or_else(|| bad("A topic needs a stable identifier."))?;
        if !ids.insert(id.to_ascii_lowercase()) {
            return Err(bad("Topic identifiers must be unique."));
        }
        let label = req(t, "label", 1, 80)?;
        let f = t["fields"]
            .as_array()
            .ok_or_else(|| bad("Check topic fields."))?;
        if f.len() > 12 {
            return Err(bad("Use up to 12 fields per topic."));
        }
        let mut fields = Vec::new();
        let mut fids = HashSet::new();
        for field in f {
            let fid = uid(field, "id")?.ok_or_else(|| bad("A field needs a stable identifier."))?;
            if !fids.insert(fid.to_ascii_lowercase()) {
                return Err(bad("Field identifiers must be unique."));
            }
            let kind = req(field, "type", 1, 10)?;
            if !matches!(kind, "text" | "number" | "date" | "select") {
                return Err(bad("Choose a supported input type."));
            }
            let mut clean = json!({"id":fid,"label":req(field,"label",1,100)?,"type":kind,"required":field["required"].as_bool().unwrap_or(false),"placeholder":txt(field,"placeholder",150)?,"unit":txt(field,"unit",30)?});
            for k in ["min", "step"] {
                if let Some(n) = field.get(k).filter(|v| !v.is_null()) {
                    let num = n
                        .as_f64()
                        .filter(|n| n.is_finite() && n.abs() <= 1e12)
                        .ok_or_else(|| bad("Check the number constraints."))?;
                    if k == "step" && num <= 0.0 {
                        return Err(bad("Step must be greater than zero."));
                    }
                    clean[k] = json!(num)
                }
            }
            if kind == "select" {
                let choices = field["options"]
                    .as_array()
                    .ok_or_else(|| bad("Add choices for this field."))?;
                if choices.is_empty() || choices.len() > 30 {
                    return Err(bad("Use between 1 and 30 choices."));
                }
                let mut list = Vec::new();
                for ch in choices {
                    let ch = ch.as_str().unwrap_or("").trim();
                    if ch.is_empty() || ch.len() > 120 || ch.contains('\0') || list.contains(&ch) {
                        return Err(bad("Check the field choices."));
                    }
                    list.push(ch);
                }
                clean["options"] = json!(list);
            }
            fields.push(clean);
        }
        let prior = old
            .as_array()
            .and_then(|a| a.iter().find(|o| o["id"] == id));
        let changed = prior.is_none_or(|p| p["label"] != label || p["fields"] != json!(fields));
        let version = prior.and_then(|p| p["version"].as_i64()).unwrap_or(0) + i64::from(changed);
        out.push(json!({"id":id,"label":label,"version":version.max(1),"fields":fields}));
    }
    Ok(json!(out))
}
pub(super) fn post_types(v: &Value, old: &Value) -> Result<Value> {
    let items = v
        .as_array()
        .ok_or_else(|| bad("Check community post types."))?;
    if items.len() > 20 {
        return Err(bad("Use up to 20 post types."));
    }
    let mut ids = HashSet::new();
    let mut labels = HashSet::new();
    let mut out = Vec::new();
    for item in items {
        let id = uid(item, "id")?
            .ok_or_else(|| bad("A post type needs a stable identifier."))?
            .to_ascii_lowercase();
        let label = req(item, "label", 1, 80)?.trim();
        if label.is_empty() || !ids.insert(id.clone()) || !labels.insert(label.to_lowercase()) {
            return Err(bad("Give each post type a unique name and identifier."));
        }
        let kind = req(item, "kind", 1, 10)?;
        if !matches!(kind, "post" | "question" | "sourcing" | "available") {
            return Err(bad("Choose a supported post type format."));
        }
        let prior = old
            .as_array()
            .and_then(|all| all.iter().find(|p| p["id"] == id));
        let changed = prior.is_none_or(|p| p["label"] != label || p["kind"] != kind);
        let version = prior.and_then(|p| p["version"].as_i64()).unwrap_or(0) + i64::from(changed);
        out.push(json!({"id":id,"label":label,"kind":kind,"version":version.max(1)}));
    }
    Ok(json!(out))
}

pub(super) fn selected_post_type(
    input: &Value,
    community: Option<&Value>,
) -> Result<(String, Option<String>, String, Option<i32>)> {
    let id = uid(input, "post_type_id")?;
    let Some(id) = id else {
        if input["kind"].as_str().is_some_and(|kind| kind != "post") {
            return Err(bad("Choose a post type created by this community's host."));
        }
        return Ok(("post".into(), None, String::new(), None));
    };
    let community = community.ok_or_else(|| bad("Choose a community for this post type."))?;
    let item = community["post_types"]
        .as_array()
        .and_then(|all| {
            all.iter()
                .find(|p| p["id"].as_str().is_some_and(|s| s.eq_ignore_ascii_case(id)))
        })
        .ok_or_else(|| {
            conflict("This post type is no longer available. Choose a current post type.")
        })?;
    let version = item["version"].as_i64().unwrap_or(1);
    if input["post_type_version"].as_i64() != Some(version) {
        return Err(conflict(
            "This post type changed. Reload it before publishing.",
        ));
    }
    let kind = item["kind"].as_str().unwrap_or("post");
    if input["kind"]
        .as_str()
        .is_some_and(|supplied| supplied != kind)
    {
        return Err(bad(
            "The post format must match the selected community post type.",
        ));
    }
    Ok((
        kind.into(),
        Some(id.to_ascii_lowercase()),
        item["label"].as_str().unwrap_or("").into(),
        Some(version as i32),
    ))
}
fn date_valid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10
        || b[4] != b'-'
        || b[7] != b'-'
        || !b
            .iter()
            .enumerate()
            .all(|(i, c)| [4, 7].contains(&i) || c.is_ascii_digit())
    {
        return false;
    }
    let y = s[0..4].parse::<i32>().unwrap_or(0);
    let m = s[5..7].parse::<usize>().unwrap_or(0);
    let d = s[8..10].parse::<usize>().unwrap_or(0);
    if !(1900..=2200).contains(&y) || !(1..=12).contains(&m) {
        return false;
    }
    let days = [
        31,
        if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
            29
        } else {
            28
        },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    d > 0 && d <= days[m - 1]
}
fn value_text(v: &Value) -> Result<String> {
    match v {
        Value::String(s) if s.len() <= 2000 && !s.contains('\0') => Ok(s.trim().to_string()),
        Value::Number(n) => Ok(n.to_string()),
        Value::Null => Ok(String::new()),
        _ => Err(bad("Check the topic answer.")),
    }
}
fn checked_value(field: &Value, value: &Value, old: Option<&Value>) -> Result<Option<Value>> {
    let value = value_text(value)?;
    if value.is_empty() {
        if field["required"] == true {
            return Err(bad("Complete the required topic fields."));
        }
        return Ok(None);
    }
    match field["type"].as_str().unwrap_or("text") {
        "number" => {
            let n = value
                .parse::<f64>()
                .ok()
                .filter(|v| v.is_finite() && v.abs() <= 1e12)
                .ok_or_else(|| bad("Enter a valid number."))?;
            if field["min"].as_f64().is_some_and(|min| n < min) {
                return Err(bad("A number is below the allowed minimum."));
            }
            if let Some(step) = field["step"].as_f64() {
                let base = field["min"].as_f64().unwrap_or(0.0);
                let ratio = (n - base) / step;
                if (ratio - ratio.round()).abs() > 1e-7 {
                    return Err(bad("Use the required number increments."));
                }
            }
        }
        "date" => {
            if !date_valid(&value) {
                return Err(bad("Enter a valid calendar date."));
            }
        }
        "select" => {
            let valid = field["options"]
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v == &value));
            let preserved = old.is_some_and(|v| value_text(v).ok().as_deref() == Some(&value));
            if !valid && !preserved {
                return Err(bad("Choose one of the available options."));
            }
        }
        "text" => {}
        _ => return Err(bad("Unsupported topic field type.")),
    }
    Ok(Some(
        json!({"field_id":field["id"],"label":field["label"],"type":field["type"],"unit":field["unit"].as_str().unwrap_or(""),"value":value}),
    ))
}
pub(super) fn answers(
    input: &Value,
    community: &Value,
) -> Result<(Option<String>, String, Option<i32>, Value)> {
    let id = uid(input, "topic_id")?;
    let all = community["topics"].as_array();
    let Some(id) = id else {
        if community["require_topic"] == true {
            return Err(bad("Choose a topic."));
        }
        return Ok((None, String::new(), None, json!([])));
    };
    let t = all
        .and_then(|a| a.iter().find(|t| t["id"] == id))
        .ok_or_else(|| conflict("This topic changed. Choose a current topic."))?;
    let ver = t["version"].as_i64().unwrap_or(1);
    if input["topic_version"].as_i64() != Some(ver) {
        return Err(conflict(
            "This topic form changed. Reload it before publishing.",
        ));
    }
    let values = input["answers"]
        .as_array()
        .ok_or_else(|| bad("Check the topic answers."))?;
    if values.len() > 12 {
        return Err(bad("Too many topic answers."));
    }
    let mut seen = HashSet::new();
    let mut map = HashMap::new();
    for a in values {
        let id = uid(a, "field_id")?.ok_or_else(|| bad("Invalid answer identifier."))?;
        if !seen.insert(id) {
            return Err(bad("Duplicate topic answer."));
        }
        map.insert(id, &a["value"]);
    }
    let fields = t["fields"]
        .as_array()
        .ok_or_else(|| bad("Invalid topic configuration."))?;
    let mut out = Vec::new();
    for f in fields {
        let fid = f["id"].as_str().unwrap_or("");
        let value = map.remove(fid).unwrap_or(&Value::Null);
        if let Some(v) = checked_value(f, value, None)? {
            out.push(v)
        }
    }
    if !map.is_empty() {
        return Err(bad("An answer does not belong to this topic."));
    }
    Ok((
        Some(id.to_string()),
        t["label"].as_str().unwrap_or("").to_string(),
        Some(ver as i32),
        json!(out),
    ))
}
pub(super) fn edit_answers(input: &Value, post: &Value, community: &Value) -> Result<Value> {
    if input.get("answers").is_none() {
        return Ok(post["answers"].clone());
    }
    let values = input["answers"]
        .as_array()
        .ok_or_else(|| bad("Check the answers."))?;
    if values.len() > 12 {
        return Err(bad("Too many answers."));
    }
    let prior = post["answers"]
        .as_array()
        .ok_or_else(|| bad("Invalid published answers."))?;
    let topic = community["topics"]
        .as_array()
        .and_then(|a| a.iter().find(|t| t["id"] == post["topic_id"]));
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for a in values {
        let id = uid(a, "field_id")?.ok_or_else(|| bad("Invalid answer identifier."))?;
        if !seen.insert(id) {
            return Err(bad("Duplicate answer."));
        }
        let old = prior
            .iter()
            .find(|a| a["field_id"] == id)
            .ok_or_else(|| bad("Published fields cannot be replaced."))?;
        let current = topic
            .and_then(|t| t["fields"].as_array())
            .and_then(|f| f.iter().find(|f| f["id"] == id && f["type"] == old["type"]));
        let mut field=current.cloned().unwrap_or_else(||json!({"id":id,"label":old["label"],"type":old["type"],"unit":old["unit"],"required":false,"options":[old["value"]]}));
        field["label"] = old["label"].clone();
        field["unit"] = old["unit"].clone();
        if let Some(value) = checked_value(&field, &a["value"], Some(&old["value"]))? {
            out.push(value)
        }
    }
    // Omitting a snapshot preserves its historical value, never silently erases required work.
    for old in prior {
        if !seen.contains(old["field_id"].as_str().unwrap_or("")) {
            out.push(old.clone())
        }
    }
    Ok(json!(out))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn date_edges() {
        assert!(date_valid("2028-02-29"));
        assert!(!date_valid("2027-02-29"));
        assert!(!date_valid("2026-13-01"));
        assert!(!date_valid("２026-01-01"));
    }
    #[test]
    fn numbers_steps_choices() {
        let f = json!({"id":"quantity","label":"Quantity","type":"number","required":true,"min":1,"step":1});
        assert!(checked_value(&f, &json!(2), None).is_ok());
        assert!(checked_value(&f, &json!(1.5), None).is_err());
        assert!(checked_value(&f, &json!("NaN"), None).is_err());
        assert!(checked_value(&f, &json!(0), None).is_err());
        let f = json!({"id":"x","type":"select","options":["A"]});
        assert!(checked_value(&f, &json!("B"), None).is_err());
        assert!(checked_value(&f, &json!("B"), Some(&json!("B"))).is_ok());
    }
    #[test]
    fn version_and_snapshot() {
        let id = "11111111-1111-4111-8111-111111111111";
        let field = "22222222-2222-4222-8222-222222222222";
        let raw = json!([{"id":id,"label":"Modules","fields":[{"id":field,"label":"Quantity","type":"number","required":true,"min":1,"step":1}]}]);
        let topics = topics(&raw, &json!([])).unwrap();
        assert_eq!(topics[0]["version"], 1);
        assert_eq!(super::topics(&raw, &topics).unwrap()[0]["version"], 1);
        let c = json!({"topics":topics,"require_topic":true});
        let a =
            json!({"topic_id":id,"topic_version":1,"answers":[{"field_id":field,"value":"200"}]});
        let got = answers(&a, &c).unwrap();
        assert_eq!(got.3[0]["label"], "Quantity");
        let mut stale = a.clone();
        stale["topic_version"] = json!(0);
        assert!(answers(&stale, &c).is_err());
    }
}
