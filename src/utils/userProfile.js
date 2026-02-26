const isAdminRoleValue = (value) => {
  if (!value) return false;
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return false;
  return (
    raw.includes("admin") ||
    raw.includes("moderator") ||
    raw.includes("staff") ||
    raw.includes("super")
  );
};

const normalizeUserTypeValue = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "user" || raw === "profile" || raw === "person") return "";
  if (
    raw.includes("community") ||
    raw.includes("club") ||
    raw.includes("society") ||
    raw.includes("organization") ||
    raw.includes("org") ||
    raw.includes("group")
  ) {
    return "community";
  }
  if (raw.includes("alumni")) return "alumni";
  if (
    raw.includes("student") ||
    raw.includes("undergrad") ||
    raw.includes("postgrad") ||
    raw.includes("postgraduate") ||
    raw.includes("graduate") ||
    raw.includes("grad")
  ) {
    return "student";
  }
  if (isAdminRoleValue(raw)) return "";
  return raw;
};

export const resolveStudentType = (user) => {
  const candidates = [
    user?.studentType,
    user?.student_type,
    user?.educationType,
    user?.education_type,
    user?.studentLevel,
    user?.level,
    user?.role,
    user?.userType,
    user?.user_type,
    user?.accountType,
    user?.account_type,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const raw = String(candidate).trim();
    if (!raw) continue;
    if (isAdminRoleValue(raw)) continue;
    return candidate;
  }
  return "";
};

export const formatStudentType = (value) => {
  if (!value) return "Student";
  const raw = String(value).trim();
  if (!raw) return "Student";
  const lower = raw.toLowerCase();
  if (lower.includes("undergrad")) return "Undergraduate";
  if (lower.includes("postgrad") || lower.includes("postgraduate")) return "Postgraduate";
  if (lower.includes("grad")) return "Graduate";
  if (lower.includes("alumni")) return "Alumni";
  if (lower === "student" || lower === "current") return "Student";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

export const resolveUserType = (user) => {
  const raw =
    user?.userType ||
    user?.user_type ||
    user?.accountType ||
    user?.account_type ||
    user?.role ||
    user?.type ||
    user?.kind ||
    "";
  const normalizedRaw = normalizeUserTypeValue(raw);
  const studentType = resolveStudentType(user);
  const normalizedStudent = normalizeUserTypeValue(studentType);
  if (normalizedRaw === "community" || normalizedStudent === "community") return "community";
  if (user?.communityName || user?.communityType || user?.community_type) return "community";
  if (normalizedRaw === "alumni" || normalizedStudent === "alumni") return "alumni";
  if (normalizedRaw) return normalizedRaw;
  if (normalizedStudent) return normalizedStudent;
  return "student";
};

export const formatUserType = (value) => {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("alumni")) return "Alumni";
  if (raw.includes("community") || raw.includes("club") || raw.includes("society")) {
    return "Community";
  }
  return "Student";
};

export const resolveCollegeName = (user) => {
  const raw =
    user?.collegeTagName ||
    user?.collegeTag?.name ||
    user?.collegeTag?.collegeName ||
    user?.collegeTag?.collegeTagName ||
    user?.collegeTag?.university ||
    user?.collegeTag ||
    user?.college ||
    user?.university ||
    user?.school ||
    user?.campus ||
    user?.collegeName ||
    user?.institution ||
    user?.schoolName ||
    user?.campusName ||
    "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object" && raw) {
    const nested =
      raw.name ||
      raw.collegeTagName ||
      raw.collegeName ||
      raw.university ||
      raw.college ||
      raw.school ||
      raw.title ||
      raw.value ||
      "";
    return String(nested || "").trim();
  }
  return "";
};

export const resolveUserBio = (user) => {
  return user?.bio || user?.about || user?.headline || "";
};

export const resolveCommunityName = (user) => {
  return (
    user?.communityName ||
    user?.community_name ||
    user?.organizationName ||
    user?.orgName ||
    user?.fullName ||
    user?.displayName ||
    ""
  );
};

export const resolveCommunityType = (user) => {
  return user?.communityType || user?.community_type || user?.organizationType || "";
};

export const formatCommunityType = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("club")) return "Club";
  if (lower.includes("society")) return "Society";
  if (lower.includes("organization") || lower.includes("org")) return "Student Organization";
  if (lower.includes("event")) return "Event Community";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

export const resolveCommunityDescription = (user) => {
  return (
    user?.communityDescription ||
    user?.community_description ||
    user?.description ||
    user?.about ||
    ""
  );
};

export const resolveCommunityEmail = (user) => {
  if (!user || typeof user !== "object") return "";
  return (
    user?.communityEmail ||
    user?.community_email ||
    user?.contact ||
    user?.contactEmail ||
    user?.contact_email ||
    user?.orgEmail ||
    user?.organizationEmail ||
    user?.businessEmail ||
    user?.email ||
    user?.mail ||
    ""
  );
};

export const buildUserPreview = (user, overrides = {}) => {
  const entity = user && typeof user === "object" ? user : {};
  const resolvedId =
    entity._id ||
    entity.id ||
    entity.userId ||
    entity.user_id ||
    entity.profileId ||
    entity.memberId ||
    "";
  const profilePicUrl =
    entity.profilePicUrl ||
    entity.profilePic ||
    entity.avatarUrl ||
    entity.avatar ||
    entity.photoUrl ||
    entity.photo ||
    entity.imageUrl ||
    entity.image ||
    entity.pictureUrl ||
    entity.picture ||
    "";
  const displayName =
    entity.displayName ||
    entity.fullName ||
    entity.name ||
    entity.communityName ||
    entity.organizationName ||
    entity.orgName ||
    entity.username ||
    "User";
  const fullName =
    entity.fullName ||
    entity.name ||
    entity.communityName ||
    entity.organizationName ||
    entity.orgName ||
    displayName;
  const username = entity.username;
  const bio = entity.bio || entity.about || entity.description || entity.headline || "";
  const friendCount =
    entity.friendCount ??
    entity.friendsCount ??
    entity.friends_count ??
    (Array.isArray(entity.friends) ? entity.friends.length : undefined);
  const publicPostsCount =
    entity.publicPostsCount ??
    entity.publicPostCount ??
    entity.public_posts_count ??
    entity.postCount ??
    undefined;
  const memberCount =
    entity.memberCount ??
    entity.membersCount ??
    entity.members_count ??
    entity.member_count ??
    undefined;

  const base = {
    _id: resolvedId,
    fullName,
    displayName,
    username,
    profilePicUrl,
    bio,
    userType:
      entity.userType ||
      entity.user_type ||
      entity.accountType ||
      entity.account_type ||
      entity.role ||
      entity.type ||
      entity.kind,
    studentType:
      entity.studentType ||
      entity.student_type ||
      entity.educationType ||
      entity.education_type,
    communityName:
      entity.communityName ||
      entity.community_name ||
      entity.organizationName ||
      entity.orgName,
    communityType:
      entity.communityType ||
      entity.community_type ||
      entity.organizationType ||
      entity.orgType,
    communityDescription:
      entity.communityDescription ||
      entity.community_description ||
      entity.description ||
      entity.about,
    communityEmail: resolveCommunityEmail(entity),
    university:
      entity.university ||
      entity.college ||
      entity.school ||
      entity.campus ||
      entity.collegeName,
    college:
      entity.college ||
      entity.university ||
      entity.school ||
      entity.campus ||
      entity.collegeName,
    friendCount,
    publicPostsCount,
    memberCount,
    isVerified: Boolean(
      entity.isVerified ||
        entity.verified ||
        entity.is_verified ||
        entity.verification?.status === "verified"
    ),
    isVerifiedCommunity: Boolean(
      entity.isVerifiedCommunity ||
        entity.verifiedCommunity ||
        entity.communityVerified ||
        entity.is_community_verified ||
        entity.verification?.community === "verified" ||
        entity.verification?.community === true
    ),
  };

  const merged = { ...base, ...overrides };
  if (!merged._id && resolvedId) merged._id = resolvedId;
  return merged;
};

export const resolveMemberCount = (user) => {
  return (
    user?.memberCount ||
    user?.membersCount ||
    user?.member_count ||
    user?.followersCount ||
    user?.followers ||
    0
  );
};

export const isUserAnonymous = (user) => {
  return Boolean(user?.isAnonymous || user?.is_anonymous || user?.anonymous);
};
