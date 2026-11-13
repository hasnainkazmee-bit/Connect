use super::*;
use std::collections::{HashMap, HashSet};

fn question_id(value: &Value, key: &str) -> Result<String> {
    let id = value[key]
        .as_str()
        .ok_or_else(|| bad("Each question needs a valid identifier."))?;
    checked_id(id)?;
    Ok(id.to_ascii_lowercase())
}

pub(super) fn parse(body: &Value) -> Result<Option<Value>> {
    let Some(value) = body.get("proposalQuestions") else {
        return Ok(None);
    };
    let entries = value
        .as_array()
        .filter(|entries| entries.len() <= 10)
        .ok_or_else(|| bad("Add up to 10 questions."))?;
    let mut ids = HashSet::new();
    let mut questions = Vec::with_capacity(entries.len());
    for entry in entries {
        let id = question_id(entry, "id")?;
        if !ids.insert(id.clone()) {
            return Err(bad("Each question needs a different identifier."));
        }
        let prompt = entry["prompt"]
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty() && text.chars().count() <= 500 && !text.contains('\0'))
            .ok_or_else(|| bad("Write a question using 1 to 500 characters."))?;
        let required = entry["required"]
            .as_bool()
            .ok_or_else(|| bad("Choose whether each question is required."))?;
        questions.push(json!({"id":id,"prompt":prompt,"required":required}));
    }
    Ok(Some(json!(questions)))
}

// Call only after locking the job row, so a quote cannot answer an obsolete list.
pub(super) fn snapshot(body: &Value, questions: &Value, actual_version: i32) -> Result<Value> {
    let questions = questions
        .as_array()
        .ok_or_else(|| conflict("The job questions could not be loaded. Refresh and try again."))?;
    match body.get("questionsVersion") {
        Some(value) => {
            let supplied = value
                .as_i64()
                .filter(|v| *v > 0 && *v <= i32::MAX as i64)
                .ok_or_else(|| bad("Choose a valid question version."))?;
            if supplied != actual_version as i64 {
                return Err(conflict(
                    "The job questions have changed. Review them before sending your quote.",
                ));
            }
        }
        None if !questions.is_empty() => {
            return Err(conflict(
                "Review the job questions before sending your quote.",
            ));
        }
        None => {}
    }
    let empty = Vec::new();
    let entries = match body.get("answers") {
        None => &empty,
        Some(value) => value
            .as_array()
            .filter(|entries| entries.len() <= 10)
            .ok_or_else(|| bad("Check your answers and try again."))?,
    };
    let mut answers = HashMap::new();
    for entry in entries {
        let id = question_id(entry, "questionId")?;
        if !questions
            .iter()
            .any(|q| q["id"].as_str() == Some(id.as_str()))
        {
            return Err(bad("An answer does not belong to this job's questions."));
        }
        let answer = entry["answer"]
            .as_str()
            .map(str::trim)
            .filter(|text| text.chars().count() <= 5000 && !text.contains('\0'))
            .ok_or_else(|| bad("Each answer must be text of up to 5,000 characters."))?;
        if answers.insert(id, answer).is_some() {
            return Err(bad("Answer each question only once."));
        }
    }
    let mut result = Vec::with_capacity(questions.len());
    for question in questions {
        let id = question["id"].as_str().unwrap_or("");
        let answer = answers.get(id).copied().unwrap_or("");
        let required = question["required"] == true;
        if required && answer.is_empty() {
            return Err(bad(
                "Answer every required question before sending your quote.",
            ));
        }
        result.push(json!({"questionId":id,"prompt":question["prompt"],"required":required,"answer":answer}));
    }
    Ok(json!(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn question_ids_are_canonical_and_duplicates_cannot_hide_in_case() {
        let id = "ABCDEFAB-1234-5678-9012-123456789ABC";
        let q = json!({"id":id,"prompt":"  Crew experience?  ","required":true});
        let parsed = parse(&json!({"proposalQuestions":[q]})).unwrap().unwrap();
        assert_eq!(parsed[0]["id"], id.to_lowercase());
        assert_eq!(parsed[0]["prompt"], "Crew experience?");
        assert!(parse(&json!({"proposalQuestions":[q,{"id":id.to_lowercase(),"prompt":"Other?","required":false}]})).is_err());
    }

    #[test]
    fn snapshots_use_server_questions_and_capture_optional_blanks() {
        let questions = json!([
            {"id":"11111111-1111-1111-1111-111111111111","prompt":"Crew size?","required":true},
            {"id":"22222222-2222-2222-2222-222222222222","prompt":"Anything else?","required":false}
        ]);
        let result = snapshot(&json!({"questionsVersion":3,"answers":[{"questionId":questions[0]["id"],"answer":"  Six  ","prompt":"Changed prompt","required":false}]}), &questions, 3).unwrap();
        assert_eq!(result[0]["prompt"], "Crew size?");
        assert_eq!(result[0]["required"], true);
        assert_eq!(result[0]["answer"], "Six");
        assert_eq!(result[1]["answer"], "");
        assert!(snapshot(&json!({"questionsVersion":2}), &questions, 3).is_err());
        assert!(snapshot(&json!({"questionsVersion":3}), &questions, 3).is_err());
        assert_eq!(snapshot(&json!({}), &json!([]), 1).unwrap(), json!([]));
    }
}
