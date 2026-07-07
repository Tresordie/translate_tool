filepath = 'chrome_extension/popup.js'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

result = []
i = 0
fixed = 0
while i < len(lines):
    if i < len(lines) - 4 and 'text = text.replace(/([^' in lines[i] and lines[i].strip().endswith('/([^'):
        if lines[i+1].strip() == '])' and '(#{1,6}' in lines[i+2]:
            indent = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
            result.append(indent + "text = text.replace(/([^\\n])\\n(#{1,6}\\s)/g, '$1\\n\\n$2');\n")
            i += 1
            while i < len(lines) and not lines[i].strip().endswith("$2');"):
                i += 1
            i += 1
            fixed += 1
            continue
    result.append(lines[i])
    i += 1

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(result)
print(f"Fixed {filepath} ({fixed} replacements)")
