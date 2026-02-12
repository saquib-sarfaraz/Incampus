export const resolveStudentType = (user) => {
  return user?.studentType || user?.student_type || user?.educationType || user?.role || "";
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
    "";
  if (typeof raw === "string" && raw) return raw.toLowerCase();
  const studentType = resolveStudentType(user);
  if (typeof studentType === "string" && studentType.toLowerCase() === "alumni") {
    return "alumni";
  }
  if (typeof studentType === "string" && studentType.toLowerCase() === "community") {
    return "community";
  }
  if (user?.communityName || user?.communityType || user?.community_type) return "community";
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
  return (
    user?.college ||
    user?.university ||
    user?.school ||
    user?.campus ||
    user?.collegeName ||
    ""
  );
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
