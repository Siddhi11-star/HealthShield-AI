"""
AI Ayurvedic Wellness & Skin Advisor
Provides Ayurvedic remedies, dosha analysis, and skin care recommendations
No authentication required - guest access enabled
"""
from flask import request, jsonify
import json
from datetime import datetime

DOSHA_SYMPTOMS_MAP = {
    'vata': {
        'keywords': ('cold', 'dry', 'joint pain', 'constipation', 'anxiety', 'insomnia', 'weakness', 'bones', 'gas'),
        'remedies': (
            'Sesame oil massage (Abhyanga) to warm and nourish',
            'Warm spices: ginger, turmeric, cumin',
            'Ghee with warm milk before bed',
            'Ashwagandha: calms vata imbalance',
            'Warm herbal teas with cardamom',
            'Oil pulling with sesame oil'
        ),
        'diet': (
            'Warm, cooked foods (avoid raw/cold)',
            'Healthy fats: ghee, sesame oil, avocado',
            'Grounding foods: root vegetables, sweet potatoes',
            'Warm liquids: herbal teas, warm water',
            'Limit caffeine and stimulants',
            'Foods to avoid: cold drinks, excessive raw foods'
        )
    },
    'pitta': {
        'keywords': ('heat', 'inflammation', 'acne', 'anger', 'heartburn', 'skin rash', 'fever', 'excess energy'),
        'remedies': (
            'Coconut oil massage to cool',
            'Cooling herbs: brahmi, neem, aloe vera',
            'Turmeric (anti-inflammatory): golden milk',
            'Brahmi tea for mental clarity',
            'Rose water cooling compress',
            'Neem paste for skin inflammation'
        ),
        'diet': (
            'Cooling foods: coconut, melons, cucumbers',
            'Energy: green vegetables, bitter foods',
            'Hydrating fruits: watermelon, grapes',
            'Avoid: spicy foods, excess salt, heavy oils',
            'Preferably sweet, bitter, astringent tastes',
            'Cool water or room temperature drinks'
        )
    },
    'kapha': {
        'keywords': ('heavy', 'sluggish', 'congestion', 'weight', 'dull', 'mucus', 'lethargy', 'slow digestion'),
        'remedies': (
            'Dry massage (Garshana) with warm sesame oil',
            'Ginger and black pepper to boost digestion',
            'Triphala: natural detoxifier',
            'Turmeric and honey combination',
            'Mustard oil massage',
            'Warming herbal teas: ginger, cinnamon, cloves'
        ),
        'diet': (
            'Light, warm, spicy foods',
            'Promote digestion: ginger, pepper, chili',
            'Reduce heavy foods, oils, and sugar',
            'Bitter and astringent tastes',
            'Avoid: sweet, salty, heavy foods',
            'Warm water or herbal teas for hydration'
        )
    }
}

GENERAL_WELLNESS_RECOMMENDATIONS = {
    'dosha': 'GENERAL WELLNESS',
    'remedies': (
        'Hydrate well and rest for the next few hours',
        'Prefer warm, light home-cooked meals',
        'Try gentle breathing or meditation for 10-15 minutes',
        'Avoid self-medicating for severe or unclear symptoms',
        'Track symptoms (start time, trigger, intensity) for better guidance'
    ),
    'diet_suggestions': (
        'Warm soups, khichdi, and easy-to-digest foods',
        'Avoid very spicy, oily, and processed foods when unwell',
        'Include fruits and vegetables for micronutrients',
        'Avoid excessive caffeine and sugary drinks',
        'Stay hydrated with water or warm herbal drinks'
    )
}

RED_FLAG_KEYWORDS = (
    'chest pain', 'pain in chest', 'shortness of breath', 'breathing difficulty',
    'fainting', 'unconscious', 'seizure', 'stroke', 'slurred speech', 'one side weakness', 'severe bleeding'
)

SKIN_TYPE_ANALYSIS = {
    'oily': {
        'characteristics': (
            'Excess sebum production',
            'Shiny appearance',
            'Enlarged pores',
            'Prone to acne'
        ),
        'remedies': (
            'Neem face pack (antimicrobial)',
            'Clay mask with turmeric (oil control)',
            "Multani mitti (Fuller's earth) paste",
            'Tea tree oil (diluted) on affected areas',
            'Aloe vera gel for hydration without oil',
            'Weekly: steaming + gentle exfoliation'
        ),
        'routine': {
            'morning': (
                'Gentle cleanser with warm water',
                'Aloe vera gel',
                'Oil-free moisturizer with SPF'
            ),
            'night': (
                'Gentle cleanser',
                'Neem paste or clay mask (2x weekly)',
                'Light serum with Vitamin C',
                'Oil-free night moisturizer'
            )
        }
    },
    'dry': {
        'characteristics': (
            'Tight feeling',
            'Flaky patches',
            'Dull appearance',
            'Sensitive'
        ),
        'remedies': (
            'Sesame oil massage (nourishing)',
            'Avocado face mask with honey',
            'Aloe vera gel mixed with rose water',
            'Coconut oil at night',
            'Milk cream mask weekly',
            'Avoid harsh scrubbing'
        ),
        'routine': {
            'morning': (
                'Gentle milk cleanser',
                'Rose water toner',
                'Nourishing moisturizer',
                'Sunscreen SPF 30+'
            ),
            'night': (
                'Gentle milk cleanser',
                'Hydrating serum',
                'Rich night cream or coconut oil',
                'Optional: Aloe vera mask'
            )
        }
    },
    'combination': {
        'characteristics': (
            'Oily T-zone',
            'Dry cheeks',
            'Mixed texture',
            'Needs balancing'
        ),
        'remedies': (
            'Turmeric + honey (balancing)',
            'Aloe vera for hydration',
            'Bentonite clay on oily zones only',
            'Rose water toning',
            'Light, balanced moisturizer',
            'Targeted neem for acne areas'
        ),
        'routine': {
            'morning': (
                'Gentle cleanser',
                'Rose water toner',
                'Lightweight moisturizer',
                'Sunscreen SPF 30+'
            ),
            'night': (
                'Gentle cleanser',
                'Targeted treatments: neem on T-zone, aloe on dry areas',
                'Light moisturizer'
            )
        }
    },
    'sensitive': {
        'characteristics': (
            'Easily reactive',
            'Red patches',
            'Stinging sensation',
            'Needs gentle care'
        ),
        'remedies': (
            'Aloe vera (soothing)',
            'Turmeric with milk (anti-inflammatory)',
            'Chamomile tea compress',
            'Coconut oil (natural soothing)',
            'Avoid harsh exfoliation',
            'Calendula (healing)'
        ),
        'routine': {
            'morning': (
                'Soft cloth with lukewarm water',
                'Aloe vera gel',
                'Hypoallergenic moisturizer',
                'Gentle sunscreen SPF 50+'
            ),
            'night': (
                'Lukewarm water rinse',
                'Chamomile hydrosol',
                'Gentle oil (sesame or coconut)',
                'Minimal products (avoid irritants)'
            )
        }
    }
}

GENERAL_SKINCARE_DIET = (
    'Water: 8-10 glasses daily for hydration',
    'Antioxidants: berries, green tea (reduce inflammation)',
    'Omega-3s: fish, flax seeds, walnuts (nourish skin)',
    'Vitamin C: citrus, bell peppers, kiwi (collagen production)',
    'Zinc: pulses, nuts, seeds (skin repair)',
    'Avoid: excess sugar (causes inflammation), excess salt (dehydrates)',
    'Limit: processed foods, excess caffeine, alcohol'
)


def analyze_symptoms_for_dosha(symptoms_text):
    """
    Analyze symptoms text to determine dominant dosha
    Returns: dosha_type, confidence, identified_keywords
    """
    if not symptoms_text or not isinstance(symptoms_text, str):
        return None, 0, []

    symptoms_lower = symptoms_text.lower()
    dosha_scores = {'vata': 0, 'pitta': 0, 'kapha': 0}
    matched_keywords = {'vata': [], 'pitta': [], 'kapha': []}

    for dosha, data in DOSHA_SYMPTOMS_MAP.items():
        for keyword in data['keywords']:
            if keyword.lower() in symptoms_lower:
                dosha_scores[dosha] += 1
                matched_keywords[dosha].append(keyword)

    total_matches = sum(dosha_scores.values())
    if total_matches == 0:
        return 'general', 35, []

    dominant_dosha = max(dosha_scores.items(), key=lambda x: x[1])[0]
    confidence = (dosha_scores[dominant_dosha] / total_matches) * 100
    return dominant_dosha, round(confidence, 1), matched_keywords[dominant_dosha]


def get_dosha_recommendations(dosha):
    """Get full recommendations for a dosha type"""
    if dosha in ('general', 'balanced'):
        return GENERAL_WELLNESS_RECOMMENDATIONS

    if dosha not in DOSHA_SYMPTOMS_MAP:
        return None

    data = DOSHA_SYMPTOMS_MAP[dosha]
    return {
        'dosha': dosha.upper(),
        'remedies': data['remedies'],
        'diet_suggestions': data['diet']
    }


def detect_red_flags(symptoms_text):
    """Find urgent symptom phrases that require immediate medical attention."""
    if not symptoms_text or not isinstance(symptoms_text, str):
        return []

    text = symptoms_text.lower()
    return [phrase for phrase in RED_FLAG_KEYWORDS if phrase in text]


def analyze_skin_type(user_skin_type, image_analysis=None):
    """
    Combine user-selected skin type with optional image analysis
    image_analysis: {'brightness': float, 'has_dark_spots': bool, 'pore_size': str}
    Returns: refined_skin_type, confidence
    """
    if user_skin_type not in SKIN_TYPE_ANALYSIS:
        return None, 0

    confidence = 70
    refined_type = user_skin_type

    if image_analysis:
        brightness = image_analysis.get('brightness', 0.5)
        has_dark_spots = image_analysis.get('has_dark_spots', False)
        pore_size = image_analysis.get('pore_size', 'medium')

        if brightness > 0.7 and pore_size == 'large':
            if user_skin_type in ('oily', 'combination'):
                confidence = min(95, confidence + 10)
            else:
                refined_type = 'oily'
                confidence = 60

        if has_dark_spots:
            confidence = min(98, confidence + 8)

    return refined_type, confidence


def get_skin_recommendations(skin_type, detected_issues=None):
    """Get skincare remedies and routine for a skin type"""
    if skin_type not in SKIN_TYPE_ANALYSIS:
        return None

    data = SKIN_TYPE_ANALYSIS[skin_type]
    remedies = list(data['remedies'])

    if detected_issues:
        if 'acne' in detected_issues:
            acne_remedies = [r for r in remedies if any(word in r.lower() for word in ('neem', 'clay', 'tea tree', 'turmeric'))]
            remedies = acne_remedies + [r for r in remedies if r not in acne_remedies]

        if 'dark circles' in detected_issues:
            remedies.append('Aloe vera under-eye mask (3x weekly)')
            remedies.append('Cucumber + rose water compress (morning)')

    return {
        'skin_type': skin_type.upper(),
        'characteristics': data['characteristics'],
        'remedies': remedies[:6],
        'routine': data['routine'],
        'diet_tips': list(GENERAL_SKINCARE_DIET)
    }


def register_ayurveda_routes(app):
    """Register Ayurveda feature routes"""

    @app.route('/api/ayurveda/analyze-symptoms', methods=['POST'])
    def analyze_symptoms():
        try:
            data = request.json or {}
            symptoms = data.get('symptoms', '').strip()
            if not symptoms:
                return jsonify({'error': 'symptoms field required'}), 400

            dosha, confidence, keywords = analyze_symptoms_for_dosha(symptoms)
            if not dosha:
                return jsonify({
                    'error': 'Could not determine dosha from symptoms',
                    'advice': 'Please describe specific symptoms like cold, heat, joint pain, etc.'
                }), 400

            recommendations = get_dosha_recommendations(dosha) or GENERAL_WELLNESS_RECOMMENDATIONS
            red_flags = detect_red_flags(symptoms)

            assistant_message = f"I understand you said: '{symptoms}'. I mapped this to Ayurvedic guidance and practical next steps."
            if red_flags:
                assistant_message = "Your input contains urgent warning symptoms. Please seek immediate medical care now."

            response = {
                'success': True,
                'dosha': recommendations['dosha'] if dosha in ('general', 'balanced') else dosha,
                'confidence': f"{confidence}%",
                'identified_symptoms': keywords,
                'remedies': recommendations['remedies'],
                'diet_suggestions': recommendations['diet_suggestions'],
                'urgent_warning': bool(red_flags),
                'red_flags': red_flags,
                'assistant_message': assistant_message,
                'disclaimer': 'This is informational guidance, not a medical diagnosis. Consult a qualified professional for ongoing symptoms.'
            }
            return jsonify(response), 200
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/ayurveda/analyze-skin', methods=['POST'])
    def analyze_skin():
        try:
            data = request.json or {}
            skin_type = data.get('skin_type', '').strip().lower()
            issues = data.get('issues', [])
            image_analysis = data.get('image_analysis')

            if not skin_type:
                return jsonify({'error': 'skin_type field required'}), 400

            refined_type, confidence = analyze_skin_type(skin_type, image_analysis)
            recommendations = get_skin_recommendations(refined_type, issues)

            response = {
                'success': True,
                'skin_type': refined_type,
                'confidence': f"{confidence}%",
                'detected_issues': issues,
                'characteristics': recommendations['characteristics'],
                'remedies': recommendations['remedies'],
                'routine': recommendations['routine'],
                'diet_tips': recommendations['diet_tips'],
                'disclaimer': 'This is an informational tool. For persistent skin issues, consult a dermatologist.'
            }
            return jsonify(response), 200
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/ayurveda/health-tips', methods=['GET'])
    def get_health_tips():
        try:
            tips = {
                'morning_routine': [
                    'Wake up early (Brahma Muhurta, before sunrise ~5:30 AM) to harness pure morning energy.',
                    'Drink 1-2 glasses of warm water on an empty stomach to awaken digestive fire (Agni) and flush toxins.',
                    'Perform tongue scraping with copper or stainless steel to remove overnight oral coating (Ama).',
                    'Practice oil pulling (Gandusha) with cold-pressed sesame or coconut oil for 5-10 minutes for oral and jaw health.',
                    'Gentle stretching, Surya Namaskar (Sun Salutations), or light yoga followed by a warm bath.',
                    'Healthy, warm breakfast tailored to your appetite — avoid skipping or overeating.'
                ],
                'lifestyle': [
                    'Follow your natural circadian rhythm: align wakefulness with daylight and rest with dusk.',
                    'Eat meals at consistent times daily to regulate metabolic enzymes and metabolic rhythm.',
                    'Avoid late-night eating; finish dinner at least 2-3 hours before sleeping.',
                    'Take a brisk 100-step walk (Shatapawali) after lunch and dinner to stimulate gentle peristalsis.',
                    'Take brief posture and screen breaks every 45-60 minutes during desk work.',
                    'Spend at least 15-20 minutes daily in natural morning sunlight to recharge Vitamin D and reset mood.'
                ],
                'diet_nutrition': [
                    'Make lunch your heaviest meal of the day (12:00 PM - 1:30 PM) when digestive fire is strongest.',
                    'Eat freshly prepared, warm, and easily digestible foods over cold, processed, or frozen items.',
                    'Chew thoroughly and eat in a calm, seated environment without phone or television distractions.',
                    'Avoid incompatible food pairings (Viruddha Ahara) like combining milk with sour fruits or fish.',
                    'Sip warm cumin-coriander-fennel (CCF) tea after meals to combat gas, bloating, and sluggish digestion.',
                    'Include all six Ayurvedic tastes (sweet, sour, salty, pungent, bitter, astringent) for satiety.'
                ],
                'hydration_detox': [
                    'Always drink room-temperature or lukewarm water; avoid ice-cold water that dampens digestive fire.',
                    'Sip water steadily throughout the day rather than chugging large amounts at once.',
                    'Drink water 30 minutes before meals or 1 hour after; only take small sips during meals.',
                    'Store drinking water overnight in a clean copper vessel for natural oligodynamic purification.',
                    'Infuse warm water with fresh lemon, crushed mint, or ginger for a natural daily detox flush.'
                ],
                'sleep_relaxation': [
                    'Aim to sleep by 10:00 PM to leverage the calming, restorative Kapha period of the night.',
                    'Turn off digital screens and blue light devices at least 1 hour before bedtime.',
                    'Massage the soles of your feet with warm sesame or Brahmi oil (Pada Abhyanga) for deep sleep.',
                    'Drink warm golden turmeric milk with a pinch of nutmeg and black pepper 30 minutes before bed.',
                    'Keep your bedroom dark, quiet, well-ventilated, and free from work-related clutter.'
                ],
                'mind_breathing': [
                    'Practice 5-10 minutes of Alternate Nostril Breathing (Anulom Vilom / Nadi Shodhana) daily.',
                    'Use belly breathing (diaphragmatic breathing) during times of acute stress or anxiety.',
                    'Engage in 10 minutes of mindfulness or silent meditation upon waking and before sleeping.',
                    'Cultivate contentment (Santosha) and practice writing down 3 things you are grateful for each day.'
                ],
                'seasonal_adjustment': [
                    'Summer (Grishma): Favor cooling herbs, coconut water, mint, watermelon, and stay hydrated in shade.',
                    'Monsoon (Varsha): Digestion weakens; eat light, warm soups, boiled water, and warming spices like ginger.',
                    'Winter (Hemanta): Appetite rises naturally; enjoy hearty grains, ghee, roasted nuts, and root vegetables.',
                    'Spring (Vasanta): Time for seasonal renewal; reduce heavy sweets and dairy; favor bitter greens and herbal teas.',
                    'Autumn (Sharad): Transition gently with moist, warming, well-oiled foods and soothing herbal infusions.'
                ],
                'common_remedies': [
                    'Indigestion & Gas: A pinch of Hing (Asafoetida) in warm water or fresh ginger slice with rock salt before meals.',
                    'Sore Throat & Cough: Gargle with warm turmeric-salt water, and take 1 tsp raw honey with black pepper.',
                    'Acidity & Heartburn: Sip cold fennel seed infusion or fresh coconut water; avoid fried and spicy dishes.',
                    'Tension Headache: Apply a cool paste of sandalwood powder or gently massage temples with peppermint oil.',
                    'Joint Stiffness: Gently massage with warm Mahanarayan or sesame oil followed by gentle warmth.'
                ]
            }
            return jsonify({'success': True, 'tips': tips}), 200
        except Exception as e:
            return jsonify({'error': str(e)}), 500
