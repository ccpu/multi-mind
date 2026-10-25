use serde::Deserialize;
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub node_id: u64,
    pub node_name: String,
    #[serde(default)]
    pub parent_id: Option<u64>,
    #[serde(default)]
    pub shadow_root_type: Option<String>,
    #[serde(default)]
    pub pseudo_type: Option<String>,
    #[serde(default)]
    pub node_value: String,
    #[serde(default)]
    pub attributes: Vec<String>,
    #[serde(default)]
    pub shadow_roots: Vec<Node>,
    #[serde(default)]
    pub pseudo_elements: Vec<Node>,
}

/// Indexes protocol nodes locally; reading text never evaluates JavaScript.
pub struct Document<'a> {
    nodes: HashMap<u64, &'a Node>,
    parents: HashMap<u64, u64>,
    children: HashMap<u64, Vec<u64>>,
    pub roots: Vec<u64>,
}

impl<'a> Document<'a> {
    pub fn title(&self) -> String {
        let mut pending = vec![self.roots[0]];
        while let Some(id) = pending.pop() {
            if self
                .nodes
                .get(&id)
                .is_some_and(|node| node.node_name == "TITLE")
            {
                return self.text(id);
            }
            if let Some(children) = self.children.get(&id) {
                pending.extend(children.iter().rev());
            }
        }
        String::new()
    }

    pub fn new(root_id: u64, nodes: &'a [Node]) -> Self {
        let mut indexed: HashMap<u64, &Node> =
            nodes.iter().map(|node| (node.node_id, node)).collect();
        let mut pending: Vec<&Node> = nodes.iter().collect();
        while let Some(node) = pending.pop() {
            indexed.entry(node.node_id).or_insert(node);
            pending.extend(node.shadow_roots.iter());
            pending.extend(node.pseudo_elements.iter());
        }
        let mut document = Self {
            nodes: indexed,
            parents: HashMap::new(),
            children: HashMap::new(),
            roots: vec![root_id],
        };
        for node in nodes {
            if let Some(parent) = node.parent_id {
                document.parents.insert(node.node_id, parent);
                if node.node_name != "#document-fragment"
                    && node.node_name != "#document"
                    && node.pseudo_type.is_none()
                {
                    document
                        .children
                        .entry(parent)
                        .or_default()
                        .push(node.node_id);
                }
            }
        }
        for node in document.nodes.values() {
            for shadow in &node.shadow_roots {
                document.parents.insert(shadow.node_id, node.node_id);
            }
            for pseudo in &node.pseudo_elements {
                document.parents.insert(pseudo.node_id, node.node_id);
            }
        }
        for node in document.nodes.values() {
            if node.shadow_root_type.as_deref() == Some("open") {
                let mut ancestor = node.node_id;
                while let Some(parent) = document.parents.get(&ancestor) {
                    ancestor = *parent;
                    if ancestor == root_id {
                        document.roots.push(node.node_id);
                        break;
                    }
                    if document
                        .nodes
                        .get(&ancestor)
                        .is_some_and(|node| node.node_name == "#document")
                    {
                        break;
                    }
                }
            }
        }
        document.roots[1..].sort_unstable();
        document
    }

    pub fn attribute(&self, id: u64, name: &str) -> Option<&str> {
        self.nodes
            .get(&id)?
            .attributes
            .chunks_exact(2)
            .find(|pair| pair[0] == name)
            .map(|pair| pair[1].as_str())
    }

    pub fn text(&self, id: u64) -> String {
        let mut text = String::new();
        let mut pending = vec![id];
        while let Some(id) = pending.pop() {
            let Some(node) = self.nodes.get(&id) else {
                continue;
            };
            if node.node_name == "#text" {
                text.push_str(&node.node_value);
            }
            if let Some(children) = self.children.get(&id) {
                pending.extend(children.iter().rev());
            }
        }
        text
    }

    pub fn closest(&self, mut id: u64, matches: &[u64]) -> Option<u64> {
        loop {
            if matches.contains(&id) {
                return Some(id);
            }
            id = *self.parents.get(&id)?;
        }
    }

    pub fn in_pre(&self, mut id: u64) -> bool {
        loop {
            if self
                .nodes
                .get(&id)
                .is_some_and(|node| node.node_name == "PRE")
            {
                return true;
            }
            let Some(parent) = self.parents.get(&id) else {
                return false;
            };
            id = *parent;
        }
    }

    pub fn hidden(&self, mut id: u64) -> bool {
        loop {
            if self.attribute(id, "hidden").is_some()
                || self.attribute(id, "aria-hidden") == Some("true")
            {
                return true;
            }
            let Some(parent) = self.parents.get(&id) else {
                return false;
            };
            id = *parent;
        }
    }
}

pub fn fingerprint(text: &str) -> String {
    let mut hash = 0_u32;
    let mut length = 0;
    for unit in text.encode_utf16() {
        length += 1;
        hash = hash.wrapping_mul(31).wrapping_add(u32::from(unit));
    }
    format!("{length}:{hash}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_shadow_roots_and_hidden_ancestors_without_changing_the_document() {
        let nodes: Vec<Node> = serde_json::from_value(serde_json::json!([
            {"nodeId": 1, "nodeName": "#document"},
            {"nodeId": 2, "parentId": 1, "nodeName": "DIV", "attributes": ["aria-hidden", "true"]},
            {"nodeId": 3, "parentId": 2, "nodeName": "BUTTON"},
            {"nodeId": 4, "parentId": 1, "nodeName": "DIV", "shadowRoots": [
                {"nodeId": 5, "nodeName": "#document-fragment", "shadowRootType": "open"}
            ]},
            {"nodeId": 6, "parentId": 5, "nodeName": "TEXTAREA"},
            {"nodeId": 7, "parentId": 6, "nodeName": "#text", "nodeValue": "Draft"},
            {"nodeId": 8, "parentId": 1, "nodeName": "BUTTON", "pseudoElements": [
                {"nodeId": 9, "nodeName": "::before", "pseudoType": "before", "pseudoElements": [
                    {"nodeId": 10, "nodeName": "::marker", "pseudoType": "marker"}
                ]}
            ]},
            {"nodeId": 11, "parentId": 1, "nodeName": "TITLE"},
            {"nodeId": 12, "parentId": 11, "nodeName": "#text", "nodeValue": "Main title"},
            {"nodeId": 13, "parentId": 1, "nodeName": "#document"},
            {"nodeId": 14, "parentId": 13, "nodeName": "TITLE"},
            {"nodeId": 15, "parentId": 14, "nodeName": "#text", "nodeValue": "Iframe title"}
        ]))
        .unwrap();
        let document = Document::new(1, &nodes);
        assert_eq!(document.roots, vec![1, 5]);
        assert!(document.hidden(3));
        assert!(!document.hidden(6));
        assert_eq!(document.closest(7, &[6]), Some(6));
        assert_eq!(document.text(6), "Draft");
        assert_eq!(document.closest(9, &[8]), Some(8));
        assert_eq!(document.closest(10, &[8]), Some(8));
        assert_eq!(document.title(), "Main title");
    }

    #[test]
    fn reads_deep_documents_without_nested_json_or_recursive_traversal() {
        let mut values = vec![serde_json::json!({"nodeId": 1, "nodeName": "#document"})];
        for id in 2..=1000 {
            values.push(serde_json::json!({"nodeId": id, "parentId": id-1, "nodeName": "DIV"}));
        }
        values.push(serde_json::json!({"nodeId": 1001, "parentId": 1000, "nodeName": "#text", "nodeValue": "Hello"}));
        let serialized = serde_json::to_string(&values).unwrap();
        let nodes: Vec<Node> = serde_json::from_str(&serialized).unwrap();
        let document = Document::new(1, &nodes);
        assert_eq!(document.text(1), "Hello");
        assert_eq!(document.closest(1001, &[2]), Some(2));
    }

    #[test]
    fn fingerprints_match_javascript_utf16_including_surrogate_pairs() {
        assert_eq!(fingerprint("☃😀"), "3:11124390");
        assert_eq!(fingerprint(""), "0:0");
    }
}
