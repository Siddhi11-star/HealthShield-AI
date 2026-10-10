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
    'normal': {
        'dosha': 'Sama / Balanced Tridosha',
        'barrier_status': 'Intact & Resilient',
        'characteristics': (
            'Balanced sebum production',
            'Smooth, uniform texture',
            'Minimal sensitivity or reactivity',
            'Small, refined pores'
        ),
        'remedies': (
            'Rose water & aloe vera daily hydration',
            'Sandalwood (Chandan) paste for radiance',
            'Cold-pressed Kumkumadi tailam (2 drops at night)',
            'Gentle honey & yogurt wash weekly',
            'Daily antioxidant serum (Vitamin C + Amla)'
        ),
        'routine': {
            'morning': (
                'Gentle pH 5.5 balancing cleanser',
                'Rose water hydrosol mist',
                'Niacinamide 5% + Hyaluronic acid serum',
                'Lightweight Ceramide fluid moisturizer',
                'Broad-spectrum Sunscreen SPF 50+ PA++++'
            ),
            'night': (
                'Gentle balancing cleanser',
                'Hydrating peptide / Centella essence',
                'Bakuchiol 1% or mild retinal emulsion',
                'Squalane-infused botanical night cream'
            )
        }
    },
    'oily': {
        'dosha': 'Kapha-predominant (Excess Sneha & Srotas congestion)',
        'barrier_status': 'Sebum-overproducing, prone to pore congestion',
        'characteristics': (
            'Excess sebum & shiny T-zone',
            'Enlarged pores & blackhead formation',
            'Prone to follicular inflammation & acne',
            'Thicker epidermal stratum corneum'
        ),
        'remedies': (
            'Neem & Lodhra antimicrobial face mask (2x weekly)',
            "Multani Mitti (Fuller's Earth) & Vetiver clay pack",
            'Tea tree & Gotu Kola targeted spot application',
            'Aloe vera cold-pressed leaf gel for oil-free hydration',
            'Triphala infused herbal water rinse'
        ),
        'routine': {
            'morning': (
                'Gentle Salicylic acid (0.5-2%) or foaming amino-acid cleanser',
                'Pore-refining Green tea & Niacinamide toner',
                'Niacinamide 5-10% + Zinc PCA 1% serum',
                'Oil-free water-gel hydrator (Hyaluronic acid + Aloe)',
                'Mattifying ultra-light fluid Sunscreen SPF 50+'
            ),
            'night': (
                'Double cleanse: Gentle Micellar water + Gel cleanser',
                'Targeted BHA (Salicylic acid 2%) or Azelaic acid 10%',
                'Oil-free calming gel moisturizer with Centella / Madecassoside',
                'Lightweight non-comedogenic overnight hydration'
            )
        }
    },
    'dry': {
        'dosha': 'Vata-predominant (Ruksha & depleted lipid envelope)',
        'barrier_status': 'Lipid-deficient, prone to TEWL (water loss)',
        'characteristics': (
            'Tight, uncomfortable feeling post-wash',
            'Flaky dry patches & rough micro-texture',
            'Dull appearance with low light reflection',
            'Accentuated fine dehydration lines'
        ),
        'remedies': (
            'Cold-pressed Kumkumadi Tailam (Saffron oil) nourishing massage',
            'Avocado, raw honey & milk cream (Malai) restorative mask',
            'Licorice (Yashtimadhu) & oat soothing treatment',
            'Pure rose water & vegetable glycerin hydrating compress',
            'Ghee (Shata Dhauta Ghrita - 100x washed ghee) barrier seal'
        ),
        'routine': {
            'morning': (
                'Cream / Milk non-foaming hydrating cleanser (or lukewarm splash)',
                'Multi-weight Hyaluronic acid & Panthenol essence',
                'Ceramide NP + Squalane nourishing serum',
                'Rich barrier repair cream (Ceramides + Shea/Glycerin)',
                'Dewy moisturizing Sunscreen SPF 50+ PA++++'
            ),
            'night': (
                'Nourishing cleansing balm / oil wash',
                'Hydrating essence layered twice (skin flooding)',
                'Gentle Retinal 0.05% or Bakuchiol paired with peptides',
                'Intense barrier lipid balm with 2 drops Kumkumadi tailam'
            )
        }
    },
    'combination': {
        'dosha': 'Pitta-Kapha dual dosha (Heat & excess sebum in T-zone, dry periphery)',
        'barrier_status': 'Zonal imbalance (oily central axis, dehydrated cheeks)',
        'characteristics': (
            'Oily forehead, nose, and chin (T-zone)',
            'Normal to tight, flaky cheeks (U-zone)',
            'Enlarged central pores with occasional dry flaking',
            'Requires dual-zone strategic balancing'
        ),
        'remedies': (
            'Multani mitti clay exclusively on T-zone',
            'Aloe vera + Rose water + Sandalwood on cheeks',
            'Raw honey + Turmeric anti-inflammatory balancing mask',
            'Manjistha herbal infusion for tone harmonization',
            'Neem leaf extract targeted to congestion spots'
        ),
        'routine': {
            'morning': (
                'Gentle balancing low-pH gel cleanser',
                'Witch Hazel (alcohol-free) or Centella soothing mist',
                'Niacinamide 5% serum (regulates sebum while hydrating)',
                'Lightweight peptide emulsion or dual-zone moisturizer',
                'Invisible hybrid Sunscreen SPF 50+ PA++++'
            ),
            'night': (
                'Gentle double cleanse (Jojoba pre-cleanse + gentle wash)',
                'Salicylic acid (BHA) on T-zone; Hyaluronic acid on cheeks',
                'Azelaic acid 10% for texture and redness control',
                'Balanced ceramide lotion (applied generously to cheeks, lightly on T-zone)'
            )
        }
    },
    'sensitive': {
        'dosha': 'Pitta-predominant (Excess Ushna/heat, inflammatory hyper-reactivity)',
        'barrier_status': 'Compromised, hyper-permeable stratum corneum',
        'characteristics': (
            'Easily flushed, burning or stinging sensations',
            'Erythema (redness) triggered by temperature or ingredients',
            'Thin, delicate epidermal barrier',
            'Prone to contact dermatitis and barrier breakdown'
        ),
        'remedies': (
            'Pure Aloe vera cold pulp & Cucumber juice compress',
            'White Sandalwood (Shwet Chandan) & Rose hydrosol cooling pack',
            'Chamomile & Licorice (Yashtimadhu) anti-inflammatory soak',
            'Gotu Kola (Mandukaparni) wound-healing repair salve',
            'Avoid all synthetic fragrances, alcohol, and physical scrubs'
        ),
        'routine': {
            'morning': (
                'Lukewarm water rinse or ultra-mild colloidal oat cleanser',
                'Pure Chamomile or Centella Asiatica calming toner',
                'Centella / Madecassoside 2% + Panthenol 5% (B5) repair serum',
                'Barrier restorative cream with Ceramides 1, 3, 6-II and Ectoin',
                '100% Mineral Zinc Oxide Sunscreen SPF 50+ (non-nano, fragrance-free)'
            ),
            'night': (
                'Ultra-gentle lipid-preserving micellar or milky wash',
                'Soothing Thermal Spring Water / Rose water compress',
                'Azelaic acid 5-10% (gentle anti-redness) or pure Barrier Serum',
                'Rich Cica / Ceramide barrier balm with Beta-Glucan'
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


SKIN_CONCERN_SOLUTIONS = {
    'acne': {
        'title': 'Acne & Active Breakouts',
        'clinical_active': 'Salicylic Acid (BHA 1-2%) & Niacinamide 4%',
        'ayurvedic_herb': 'Neem (Azadirachta indica) & Lodhra Bark',
        'synergy': 'Salicylic acid clears deep follicular sebum plugs, while Neem provides broad antibacterial action against Cutibacterium acnes without disturbing natural skin moisture.',
        'am_step': 'Niacinamide 4-5% serum to suppress sebum overproduction and soothe micro-inflammation.',
        'pm_step': 'Targeted BHA 1-2% liquid exfoliant 3 nights weekly, followed by cooling Aloe gel.',
        'avoid': 'Heavy occlusive pore-clogging oils (e.g. coconut oil on face), rough physical walnut scrubs, and high-glycemic dairy.',
        'remedy': 'Purifying Neem, Wild Turmeric & Fuller’s Earth (Multani Mitti) pack twice weekly.'
    },
    'cystic_acne': {
        'title': 'Cystic & Hormonal Blemishes',
        'clinical_active': 'Azelaic Acid 10% & Zinc PCA 1%',
        'ayurvedic_herb': 'Manjistha (Rubia cordifolia) & Guggulu',
        'synergy': 'Azelaic acid reduces deep follicular hyper-keratinization; Manjistha acts as a premier Ayurvedic blood purifier (Raktashodhaka) to pacify aggravated Pitta-Kapha heat.',
        'am_step': 'Azelaic acid 10% suspension on affected regions to soothe tender inflammatory lesions.',
        'pm_step': 'Cooling Zinc PCA + Gotu Kola soothing spot gel; never squeeze or attempt mechanical extraction.',
        'avoid': 'Comedogenic mineral waxes, synthetic fragrances, picking at lesions, and excess dairy/refined sugars.',
        'remedy': 'Warm Turmeric & White Sandalwood compress applied directly to tender nodules for 10 minutes.'
    },
    'blackheads_pores': {
        'title': 'Enlarged Pores & Congestion',
        'clinical_active': 'Salicylic Acid (BHA 2%) & Niacinamide 5%',
        'ayurvedic_herb': 'Triphala & Vetiver (Khus) Hydrosol',
        'synergy': 'Lipophilic BHA dissolves oxidized sebum filaments inside the pores; astringent Triphala polyphenols and Vetiver tone tissue laxity and minimize pore visibility.',
        'am_step': 'Spritz pore-refining Vetiver hydrosol, followed by Niacinamide 5% to regulate sebum flow.',
        'pm_step': 'Leave-on Salicylic Acid 2% liquid 3 nights weekly on central T-zone.',
        'avoid': 'Abrasive pore-strips (which cause capillary damage and loss of elasticity) and heavy waxes.',
        'remedy': 'French Green Clay & Triphala botanical paste (10 mins, rinse before completely cracked dry).'
    },
    'pigmentation': {
        'title': 'Post-Acne Marks & Hyperpigmentation',
        'clinical_active': 'Alpha Arbutin 2% & Tranexamic Acid 3%',
        'ayurvedic_herb': 'Kumkumadi Tailam (Kashmiri Saffron) & Yashtimadhu (Licorice)',
        'synergy': 'Alpha Arbutin safely inhibits tyrosinase melanin synthesis; Kashmiri Saffron and Licorice Glabridin accelerate epidermal pigment dissipation and impart luminosity.',
        'am_step': 'Antioxidant Vitamin C (10-15%) or Alpha Arbutin 2% serum followed by mandatory broad-spectrum SPF 50+.',
        'pm_step': 'Massage 2-3 drops authentic Kumkumadi Tailam into slightly damp skin at night.',
        'avoid': 'Unprotected direct sun exposure (UV instantly reignites melanocyte activity) and harsh chemical peels.',
        'remedy': 'Licorice root (Yashtimadhu) powder & wild turmeric steeped in pure rose water as a 15-min mask.'
    },
    'melasma': {
        'title': 'Melasma & Hormonal Sun Spots',
        'clinical_active': 'Tranexamic Acid 3-5% & Kojic Acid 1%',
        'ayurvedic_herb': 'Manjistha & Chandan (White Sandalwood)',
        'synergy': 'Tranexamic acid halts UV-induced plasmin activity and inflammatory melanogenesis; cooling Chandan pacifies localized Pitta heat while Manjistha evens out discoloration.',
        'am_step': 'Tranexamic acid 3-5% serum topped with a tinted Mineral Zinc Oxide SPF 50+ (iron oxides block visible light).',
        'pm_step': 'Kojic Acid / Licorice brightening concentrate paired with barrier-replenishing Ceramide cream.',
        'avoid': 'Extreme infrared/thermal heat exposure (saunas, hot hair dryers near face), harsh scrubs, and chemical sunscreens.',
        'remedy': 'Cooling Sandalwood paste with chilled cucumber juice applied to pigmented patches.'
    },
    'dark_circles': {
        'title': 'Under-Eye Dark Circles & Fatigue',
        'clinical_active': 'Caffeine 5% + EGCG & Multi-Peptide Complex',
        'ayurvedic_herb': 'Pure Rose Hydrosol, Cucumber & Sweet Almond Oil',
        'synergy': 'Caffeine constricts stagnant under-eye micro-capillaries; chilled Rose hydrosol and bioflavonoids stimulate lymphatic drainage to reduce puffiness.',
        'am_step': 'Tap a drop of Caffeine 5% eye serum lightly along the orbital bone using your ring finger.',
        'pm_step': 'Peptide eye recovery balm with 1 drop pure cold-pressed Sweet Almond oil.',
        'avoid': 'Late-night blue-light screen exposure, chronic sleep deprivation, and aggressive eye rubbing.',
        'remedy': 'Chilled organic Rose water soaked cotton eye pads placed over closed eyelids for 10 minutes.'
    },
    'dull_skin': {
        'title': 'Dull Skin & Lack of Radiance',
        'clinical_active': 'L-Ascorbic Acid (Vitamin C 15%) & Lactic Acid 5%',
        'ayurvedic_herb': 'Amla (Indian Gooseberry) & Saffron',
        'synergy': 'Vitamin C and Amla bioflavonoids neutralize free radical damage and promote collagen synthesis; gentle Lactic acid dissolves dead corneocytes for instant radiance.',
        'am_step': 'L-Ascorbic Acid 10-15% serum applied to dry skin, sealed with lightweight moisturizer and SPF.',
        'pm_step': 'Gentle mild Lactic Acid 5% or Papaya enzyme exfoliant twice weekly.',
        'avoid': 'Inadequate hydration, smoking/smog, and stripping sulfate cleansers that dull the skin barrier.',
        'remedy': 'Besan (Gram flour) + pinch of wild turmeric + fresh curd/rose water traditional Ubtan mask.'
    },
    'fine_lines': {
        'title': 'Fine Lines & Collagen Support',
        'clinical_active': 'Bakuchiol 1% / Retinoid & Copper Peptide Complex',
        'ayurvedic_herb': 'Gotu Kola (Mandukaparni) & Ashwagandha',
        'synergy': 'Bakuchiol stimulates collagen type I and III without retinoid dermatitis; Gotu Kola triterpenoids promote cellular remodeling, elasticity, and dermal density.',
        'am_step': 'Multi-peptide serum with Hyaluronic acid, followed by firming Ceramide lotion and SPF 50+.',
        'pm_step': 'Bakuchiol 1% in Squalane (or mild retinal emulsion) 3 nights weekly for cell renewal.',
        'avoid': 'Skipping sunscreen (UV causes 80% of premature collagen breakdown) and tugging skin during cleansing.',
        'remedy': 'Nourishing Gotu Kola oil massage with gentle upward lifting strokes before bedtime.'
    },
    'redness_rosacea': {
        'title': 'Redness, Flushing & Rosacea',
        'clinical_active': 'Azelaic Acid 10% & Centella Asiatica (Cica / Madecassoside)',
        'ayurvedic_herb': 'White Sandalwood (Chandan) & Khus (Vetiver)',
        'synergy': 'Azelaic acid decreases cathelicidin inflammatory peptides; Sandalwood pacifies acute Pitta fire and calms reactive micro-capillaries.',
        'am_step': 'Centella Asiatica calming essence + Azelaic Acid 10% + 100% Mineral Zinc Oxide SPF 50+.',
        'pm_step': 'Ultra-gentle soothing barrier cream containing Colloidal Oat, Ectoin, and Panthenol.',
        'avoid': 'Hot water showers, spicy chili foods, alcohol, synthetic perfume, and foaming SLS cleansers.',
        'remedy': 'Cold Chamomile infusion & pure Aloe vera compress to promptly drop skin temperature.'
    },
    'barrier_damage': {
        'title': 'Compromised Skin Barrier & Stinging',
        'clinical_active': 'Ceramides (1, 3, 6-II), Cholesterol & Fatty Acids (3:1:1)',
        'ayurvedic_herb': 'Shata Dhauta Ghrita (100x Washed Ghee) & Colloidal Oat',
        'synergy': 'Physiological lipid matrix restores the depleted intercellular lipid mortar; Shata Dhauta Ghrita provides cooling bio-mimetic fatty acids that halt moisture loss immediately.',
        'am_step': 'Skip morning soap cleanser (lukewarm water rinse only); apply Ceramide barrier cream + Mineral SPF.',
        'pm_step': 'Gentle milky cleanser; layer Panthenol 5% (B5) + rich Ceramide restorative recovery balm.',
        'avoid': 'ALL active acids (AHA/BHA), retinoids, pure Vitamin C, essential oils, and rough towels until fully recovered.',
        'remedy': 'Thin layer of pure 100x washed ghee (or squalane) over damp skin before sleep.'
    },
    'dehydration': {
        'title': 'Dehydrated Skin (Water-Deficient)',
        'clinical_active': 'Multi-Depth Hyaluronic Acid & Polyglutamic Acid',
        'ayurvedic_herb': 'Kumari (Pure Aloe Vera) & Rose Hydrosol',
        'synergy': 'Multi-molecular Hyaluronic acid and Polyglutamic acid bind water across epidermal strata; Aloe polysaccharides create a flexible humectant moisture reservoir.',
        'am_step': 'Mist face with Rose hydrosol, apply Hyaluronic acid on damp skin, and immediately seal with moisturizer.',
        'pm_step': 'Layer hydrating botanical essence (2-3 coats) + barrier-locking ceramide emulsion.',
        'avoid': 'Applying Hyaluronic acid onto dry skin in dry air (it pulls water out of deeper dermis).',
        'remedy': 'Fresh aloe vera leaf gel blended with 2 drops pure vegetable glycerin as a 20-min moisture wash.'
    }
}


def analyze_skin_type(user_skin_type, image_analysis=None):
    """
    Combine user-selected skin type with multi-metric image analysis
    image_analysis can include:
    - brightness: float 0.0 - 1.0
    - redness_score: float 0.0 - 1.0
    - oil_shine_score: float 0.0 - 1.0
    - texture_variance: float
    - pore_size: 'small' | 'medium' | 'large'
    - has_dark_spots: bool
    Returns: refined_skin_type, confidence, visual_metrics
    """
    if user_skin_type not in SKIN_TYPE_ANALYSIS:
        user_skin_type = 'normal'

    confidence = 82
    refined_type = user_skin_type
    visual_metrics = {}

    if image_analysis and isinstance(image_analysis, dict):
        brightness = float(image_analysis.get('brightness', 0.5))
        redness_score = float(image_analysis.get('redness_score', 0.0))
        oil_shine_score = float(image_analysis.get('oil_shine_score', 0.0))
        has_dark_spots = bool(image_analysis.get('has_dark_spots', False))
        pore_size = str(image_analysis.get('pore_size', 'medium'))

        visual_metrics = {
            'brightness_pct': round(brightness * 100, 1),
            'redness_index': round(redness_score * 100, 1),
            'oil_shine_index': round(oil_shine_score * 100, 1),
            'detected_pores': pore_size,
            'detected_spots': has_dark_spots
        }

        # Check for redness / reactive inflammation
        if redness_score > 0.45 or (image_analysis.get('has_redness', False)):
            if user_skin_type in ('sensitive', 'dry'):
                refined_type = 'sensitive'
                confidence = min(96, confidence + 12)
            elif user_skin_type == 'normal':
                refined_type = 'sensitive'
                confidence = 78

        # Check for sebum shine & pore visibility
        if oil_shine_score > 0.4 or (brightness > 0.65 and pore_size == 'large'):
            if user_skin_type in ('oily', 'combination'):
                refined_type = user_skin_type
                confidence = min(97, confidence + 10)
            elif user_skin_type == 'normal':
                refined_type = 'combination'
                confidence = 80

        # Check for dry / low reflection
        if brightness < 0.4 and oil_shine_score < 0.15:
            if user_skin_type in ('dry', 'sensitive'):
                confidence = min(95, confidence + 8)

        if has_dark_spots:
            confidence = min(98, confidence + 6)

    return refined_type, confidence, visual_metrics


def get_comprehensive_skin_regimen(skin_type, detected_issues=None, age_group=None, climate=None, experience_level=None):
    """
    Build a bespoke, dermatologically & Ayurvedically synergistic skincare routine.
    """
    if skin_type not in SKIN_TYPE_ANALYSIS:
        skin_type = 'normal'

    base_data = SKIN_TYPE_ANALYSIS[skin_type]
    issues = [str(i).lower().replace(' ', '_').replace('&', '').strip() for i in (detected_issues or [])]

    # Map aliases
    issue_keys = []
    for raw in (detected_issues or []):
        r = str(raw).lower()
        if 'cystic' in r or 'hormon' in r:
            issue_keys.append('cystic_acne')
        elif 'blackhead' in r or 'pore' in r:
            issue_keys.append('blackheads_pores')
        elif 'acne' in r or 'breakout' in r:
            issue_keys.append('acne')
        elif 'melasma' in r:
            issue_keys.append('melasma')
        elif 'dark circle' in r or 'under eye' in r:
            issue_keys.append('dark_circles')
        elif 'pigment' in r or 'pih' in r:
            issue_keys.append('pigmentation')
        elif 'dull' in r:
            issue_keys.append('dull_skin')
        elif 'line' in r or 'wrinkle' in r or 'aging' in r:
            issue_keys.append('fine_lines')
        elif 'red' in r or 'rosacea' in r:
            issue_keys.append('redness_rosacea')
        elif 'barrier' in r or 'sting' in r:
            issue_keys.append('barrier_damage')
        elif 'dehydrat' in r:
            issue_keys.append('dehydration')

    # Deduplicate while preserving order
    seen = set()
    cleaned_issues = [x for x in issue_keys if not (x in seen or seen.add(x))]

    # Gather synergistic ingredients and solutions
    synergies = []
    avoids = set()
    custom_remedies = list(base_data['remedies'])
    am_special_steps = []
    pm_special_steps = []

    for k in cleaned_issues:
        sol = SKIN_CONCERN_SOLUTIONS.get(k)
        if sol:
            synergies.append({
                'concern': sol['title'],
                'clinical_active': sol['clinical_active'],
                'ayurvedic_herb': sol['ayurvedic_herb'],
                'synergy_explanation': sol['synergy'],
                'key_am_step': sol['am_step'],
                'key_pm_step': sol['pm_step']
            })
            avoids.add(sol['avoid'])
            if sol['remedy'] not in custom_remedies:
                custom_remedies.insert(0, sol['remedy'])
            am_special_steps.append(sol['am_step'])
            pm_special_steps.append(sol['pm_step'])

    # Build structured AM steps
    am_routine = [
        {
            'step': 1,
            'phase': 'Cleanse',
            'product': 'Gentle Non-Stripping Cleanser',
            'instructions': 'Use lukewarm water. Massage for 45-60 seconds in circular motions; do not pull skin.',
            'focus': 'Preserve natural acid mantle (pH 5.5)'
        },
        {
            'step': 2,
            'phase': 'Tone / Prep',
            'product': 'Hydrosol & Botanical Essence',
            'instructions': 'Pat gently onto damp face (Pure Rose, Centella, or Vetiver hydrosol).',
            'focus': 'Cellular hydration prep'
        },
        {
            'step': 3,
            'phase': 'Target Treatment',
            'product': am_special_steps[0] if am_special_steps else 'Antioxidant Niacinamide 5% + Hyaluronic Acid Serum',
            'instructions': 'Smooth 2-3 drops evenly over face and neck before moisturizing.',
            'focus': 'Targeted active delivery'
        },
        {
            'step': 4,
            'phase': 'Moisturize',
            'product': 'Barrier Replenishing Fluid or Cream',
            'instructions': 'Apply pea-sized amount to lock in hydration and reinforce lipid matrix.',
            'focus': 'Ceramides, squalane & moisture seal'
        },
        {
            'step': 5,
            'phase': 'Sun Protection',
            'product': 'Broad Spectrum Sunscreen SPF 50+ PA++++',
            'instructions': 'Apply two finger-lengths generously. Reapply every 2-3 hours if outdoors.',
            'focus': 'UV & visible light defense'
        }
    ]

    # Build structured PM steps
    pm_routine = [
        {
            'step': 1,
            'phase': 'First Cleanse',
            'product': 'Micellar Water or Botanical Cleansing Balm',
            'instructions': 'Melt away sunscreen, ambient micro-pollutants, and excess oxidized sebum.',
            'focus': 'Gentle breakdown of oil-soluble grime'
        },
        {
            'step': 2,
            'phase': 'Second Cleanse',
            'product': 'Balancing pH 5.5 Gel or Milk Wash',
            'instructions': 'Wash with fingertips to ensure a perfectly clean, calm canvas.',
            'focus': 'Water-soluble residue removal'
        },
        {
            'step': 3,
            'phase': 'Repair & Active',
            'product': pm_special_steps[0] if pm_special_steps else (base_data['routine']['night'][2] if len(base_data['routine']['night']) > 2 else 'Botanical Renewal Complex'),
            'instructions': 'Apply onto dry skin. Allow 2 minutes to absorb before sealing.',
            'focus': 'Cellular turnover and overnight repair'
        },
        {
            'step': 4,
            'phase': 'Overnight Barrier Seal',
            'product': 'Lipid Recovery Cream + 2 drops Kumkumadi / Squalane',
            'instructions': 'Warm in palms and press into skin for complete transepidermal barrier protection.',
            'focus': 'Prevent nocturnal TEWL (water evaporation)'
        }
    ]

    # Weekly DIY herbal mask
    if 'barrier_damage' in cleaned_issues or skin_type == 'sensitive':
        weekly_mask = {
            'title': 'Soothing Oat & Chandan Barrier Pacifier',
            'frequency': '1-2 times weekly',
            'ingredients': '1 tbsp Colloidal Oatmeal, 1/2 tsp White Sandalwood powder, 2 tbsp pure Aloe vera gel',
            'preparation': 'Mix into a smooth paste. Apply for 12-15 minutes. Rinse gently with cool water without scrubbing.',
            'benefits': 'Instantly dispels cutaneous heat, calms micro-vessels, and reinforces stratum corneum lipids.'
        }
    elif 'acne' in cleaned_issues or 'cystic_acne' in cleaned_issues or skin_type == 'oily':
        weekly_mask = {
            'title': 'Purifying Neem, Triphala & Clay Detox Lepa',
            'frequency': '2 times weekly',
            'ingredients': '1 tbsp Multani Mitti (Fuller\'s Earth), 1/2 tsp Neem leaf powder, 1 pinch Kasturi Turmeric, Rose water',
            'preparation': 'Form a silky paste. Apply for 10 minutes. Rinse before it cracks dry to prevent drawing moisture out.',
            'benefits': 'Draws follicular congestion, destroys surface microbes, and refines enlarged pores.'
        }
    elif 'pigmentation' in cleaned_issues or 'melasma' in cleaned_issues or 'dull_skin' in cleaned_issues:
        weekly_mask = {
            'title': 'Royal Kashmiri Saffron & Yashtimadhu Radiance Pack',
            'frequency': '2 times weekly',
            'ingredients': '1 tbsp Gram flour (Besan), 1/2 tsp Licorice (Yashtimadhu) powder, 2 strands crushed Saffron, 1 tbsp raw milk/rose water',
            'preparation': 'Let saffron steep in warm milk for 5 mins, blend all ingredients into paste. Leave on for 15 mins and wash off.',
            'benefits': 'Inhibits localized tyrosinase, accelerates cellular shedding of post-acne dark spots, and restores natural glow.'
        }
    else:
        weekly_mask = {
            'title': 'Tridoshic Honey & Rose Rejuvenating Lepa',
            'frequency': 'Weekly',
            'ingredients': '1 tbsp Raw forest Honey, 1 tsp Rose hydrosol, 1/2 tsp pure Sandalwood powder',
            'preparation': 'Whisk together and apply all over face for 15-20 minutes. Rinse with lukewarm water.',
            'benefits': 'Gentle enzymatic renewal, intense humectant hydration, and harmonized skin texture.'
        }

    # Dietary & internal wellness advice
    diet_guidance = [
        'Optimal Hydration: Sip 2.5 - 3 Liters of room-temperature or copper-infused water daily; avoid ice-cold water that dampens digestive Agni.',
        'Herbal Infusion: Drink cumin-coriander-fennel (CCF) tea to eliminate metabolic Ama (toxins) that manifest as cutaneous breakouts.',
        'Antioxidant Shield: Consume Indian Gooseberry (Amla) daily — richest natural source of stable Vitamin C for natural collagen formation.',
        'Healthy Fats: Include 1 tsp organic A2 Ghee, soaked walnuts, and flaxseeds daily to nourish the skin lipid matrix from within.',
        'Pitta Cooling: If experiencing redness or active acne, avoid deep-fried foods, excessive green chilies, and refined sugars.'
    ]

    # General avoid list
    general_avoids = [
        'Never use rough apricot/walnut kernel scrubs (causes micro-tears and accelerates inflammatory hyperpigmentation).',
        'Avoid washing your face with hot water (melts away vital skin barrier lipids and triggers reactive sebum surges).',
        'Do not combine strong BHA acids with high-strength Retinoids in the same application routine.',
        'Avoid picking or popping inflammatory blemishes (causes permanent dermal scarring and deep PIH).'
    ]
    for av in avoids:
        if av and av not in general_avoids:
            general_avoids.insert(0, av)

    return {
        'skin_type': skin_type.upper(),
        'dosha_profile': base_data.get('dosha', 'Balanced Tridosha'),
        'barrier_status': base_data.get('barrier_status', 'Intact'),
        'characteristics': base_data['characteristics'],
        'synergies': synergies,
        'am_routine': am_routine,
        'pm_routine': pm_routine,
        'weekly_ritual': weekly_mask,
        'avoid_list': general_avoids[:5],
        'remedies': custom_remedies[:6],
        'routine': base_data['routine'],
        'diet_tips': diet_guidance,
        'disclaimer': 'This holistic advisor combines clinical dermatology standards with traditional Ayurvedic principles for informational decision support. Consult a licensed dermatologist for chronic dermatological conditions.'
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
            age_group = data.get('age_group')
            climate = data.get('climate')
            experience_level = data.get('experience_level')
            image_analysis = data.get('image_analysis')

            if not skin_type:
                return jsonify({'error': 'skin_type field required'}), 400

            refined_type, confidence, visual_metrics = analyze_skin_type(skin_type, image_analysis)
            regimen = get_comprehensive_skin_regimen(
                refined_type,
                detected_issues=issues,
                age_group=age_group,
                climate=climate,
                experience_level=experience_level
            )

            response = {
                'success': True,
                'skin_type': refined_type,
                'confidence': f"{confidence}%",
                'detected_issues': issues,
                'dosha_profile': regimen['dosha_profile'],
                'barrier_status': regimen['barrier_status'],
                'characteristics': regimen['characteristics'],
                'synergies': regimen['synergies'],
                'am_routine': regimen['am_routine'],
                'pm_routine': regimen['pm_routine'],
                'weekly_ritual': regimen['weekly_ritual'],
                'avoid_list': regimen['avoid_list'],
                'visual_metrics': visual_metrics,
                'remedies': regimen['remedies'],
                'routine': regimen['routine'],
                'diet_tips': regimen['diet_tips'],
                'disclaimer': regimen['disclaimer']
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
