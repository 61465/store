import json
with open('d:/store/operations-v21-enterprise/search_results.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
print(f'Total matches: {len(data)}')
for item in data:
    text = item['text'].lower()
    if 'التقرير' in text or 'المسؤول' in text or 'نواقص' in text or 'انستا' in text or 'النهائي' in text:
        # Avoid printing arabic to console, instead let's print the line numbers where these occur
        print(f"Line {item['line']}")
